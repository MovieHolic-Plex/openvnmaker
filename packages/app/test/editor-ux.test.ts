import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, parseScript, type Scene, type VnScript } from "@vnmaker/content";
import { duplicateLine, insertLines, moveLine, removeLine, splitPastedText } from "../src/studio/lineOperations.js";
import { findText, replaceAll, replaceInMatch } from "../src/studio/findReplace.js";
import { duplicateScene, renameScene } from "../src/studio/sceneOperations.js";
import { renameCharacter } from "../src/studio/characterOperations.js";
import { renameFlag } from "../src/studio/stateOperations.js";
import { editIssue } from "../src/studio/editGuard.js";
import { collectMediaReferences, findMissingMedia } from "../src/studio/mediaIntegrity.js";
import { withNarrativeIds } from "../src/studio/narrativeIds.js";

const scene = (id: string, extra: Partial<Scene> = {}): Scene => ({ id, chapter: `${id} 장`, background: "title", lines: [{ id: `${id}-1`, speaker: null, text: `${id} 첫 줄` }, { id: `${id}-2`, speaker: "hero", text: `${id} 둘째 줄` }], ...extra });
const story: VnScript = parseScript({
  title: "편집 검증", subtitle: "", start: "a", flags: { trust: 0, letter: false },
  characters: [{ id: "hero", name: "주인공", color: "#aabbcc", bio: "", expressionImages: { neutral: "/assets/user/" + "1".repeat(64) + ".png" } }],
  scenes: [
    scene("a", { backgroundUrl: "/assets/art/rain-library.png", choices: [{ id: "c1", text: "편지를 챙긴다", next: "b", set: { letter: true }, add: { trust: 1 } }, { id: "c2", text: "두고 간다", next: "b", when: { compare: [{ flag: "trust", op: "gte", value: 1 }] } }] }),
    scene("b", { lines: [{ speaker: "hero", text: "문 앞. 편지를 꺼낸다.", when: { all: ["letter"] }, voice: "/assets/user/" + "2".repeat(64) + ".mp3" }, { speaker: null, text: "비가 그쳤다." }], ending: "귀가" }),
  ],
  assets: [{ id: "art-1", name: "도서관", kind: "background", url: "/assets/art/rain-library.png", sceneId: "a" }],
});

test("line operations move, duplicate without identity, remove with a floor and insert in bulk", () => {
  const source = story.scenes[0]!;
  const moved = moveLine(source, 0, 1);
  assert.deepEqual(moved.lines.map(line => line.id), ["a-2", "a-1"]);
  assert.equal(moveLine(source, 0, 0), source);
  assert.equal(moveLine(source, 1, 99).lines[0]!.id, "a-1", "out-of-range targets clamp instead of dropping lines");
  assert.throws(() => moveLine(source, 5, 0));
  const copied = duplicateLine(source, 0);
  assert.equal(copied.lines.length, 3); assert.equal(copied.lines[1]!.text, source.lines[0]!.text); assert.equal(copied.lines[1]!.id, undefined, "copies must not carry the original identity");
  assert.notEqual(withNarrativeIds({ ...story, scenes: [copied] }, () => "fresh").scenes[0]!.lines[1]!.id, "a-1");
  assert.equal(removeLine(source, 1).lines.length, 1);
  assert.throws(() => removeLine(removeLine(source, 1), 0), /최소/);
  const inserted = insertLines(source, 0, [{ speaker: null, text: "삽입 1" }, { speaker: null, text: "삽입 2" }]);
  assert.deepEqual(inserted.lines.map(line => line.text), ["a 첫 줄", "삽입 1", "삽입 2", "a 둘째 줄"]);
  assert.equal(insertLines(source, -1, [{ speaker: null, text: "맨 앞" }]).lines[0]!.text, "맨 앞");
  assert.equal(insertLines(source, 0, []), source);
});

test("pasted manuscript splits into lines, resolving known speaker prefixes and keeping unknown ones as narration", () => {
  const lines = splitPastedText("주인공: 첫 대사\r\n\n  hero： ID로도 맞는다  \n낯선이: 이 접두는 남긴다\n내레이션만 있는 줄\n", story.characters);
  assert.deepEqual(lines, [
    { speaker: "hero", text: "첫 대사" },
    { speaker: "hero", text: "ID로도 맞는다" },
    { speaker: null, text: "낯선이: 이 접두는 남긴다" },
    { speaker: null, text: "내레이션만 있는 줄" },
  ]);
  assert.deepEqual(splitPastedText("   \n\n", story.characters), []);
  assert.doesNotThrow(() => parseScript({ ...story, scenes: [insertLines(story.scenes[0]!, 1, lines)] }));
});

test("find and replace covers dialogue and choice labels, counts occurrences and is undoable as one script", () => {
  const matches = findText(story, "편지");
  assert.deepEqual(matches.map(match => `${match.sceneId}:${match.kind}:${match.index}`), ["a:choice:0", "b:line:0"]);
  assert.equal(findText(story, "").length, 0);
  assert.equal(findText(story, "BI가")[0]?.text, undefined, "no-case query still requires the same letters");
  assert.equal(findText(story, "비가")[0]?.text, "비가 그쳤다.");
  const all = replaceAll(story, "편지", "쪽지");
  assert.equal(all.replaced, 2);
  assert.equal(all.script.scenes[0]!.choices![0]!.text, "쪽지를 챙긴다");
  assert.equal(all.script.scenes[1]!.lines[0]!.text, "문 앞. 쪽지를 꺼낸다.");
  assert.equal(all.script.scenes[0]!.lines, story.scenes[0]!.lines, "untouched arrays keep their reference so undo/memo see no change");
  assert.equal(replaceAll(story, "없는 문자열", "x").script, story);
  const one = replaceInMatch(story, matches[1]!, "편지", "쪽지");
  assert.equal(one.scenes[0]!.choices![0]!.text, "편지를 챙긴다");
  assert.equal(one.scenes[1]!.lines[0]!.text, "문 앞. 쪽지를 꺼낸다.");
  assert.equal(replaceAll(story, "a.c", "x").replaced, 0, "regex metacharacters are literal");
  assert.equal(replaceAll({ ...story, scenes: [scene("z", { lines: [{ speaker: null, text: "$1 그대로" }] })] }, "그대로", "$&$1").script.scenes[0]!.lines[0]!.text, "$1 $&$1", "replacement strings are literal too");
});

test("duplicating a scene leaves the original exits intact and inserts a full copy right after it", () => {
  const copied = duplicateScene(story, "a", "a-copy");
  assert.deepEqual(copied.scenes.map(row => row.id), ["a", "a-copy", "b"]);
  assert.deepEqual(copied.scenes[0], story.scenes[0], "the original is untouched");
  assert.deepEqual(copied.scenes[1]!.choices, story.scenes[0]!.choices);
  assert.equal(copied.scenes[1]!.chapter, "a 장 · 복사");
  assert.doesNotThrow(() => parseScript(copied));
  assert.throws(() => duplicateScene(story, "a", "b"));
});

test("renaming a scene rewrites start, next, choice targets and asset scenes; invalid or taken ids are rejected", () => {
  const renamed = renameScene({ ...story, scenes: [...story.scenes, scene("c", { next: "a" })] }, "a", "opening");
  assert.equal(renamed.start, "opening");
  assert.equal(renamed.scenes[0]!.id, "opening");
  assert.equal(renamed.scenes[2]!.next, "opening");
  assert.equal(renamed.assets![0]!.sceneId, "opening");
  const back = renameScene(renamed, "b", "ending-b");
  assert.deepEqual(back.scenes[0]!.choices!.map(choice => choice.next), ["ending-b", "ending-b"]);
  assert.doesNotThrow(() => parseScript(back));
  assert.equal(renameScene(story, "a", "a"), story);
  assert.throws(() => renameScene(story, "a", "b"), /사용 중/);
  assert.throws(() => renameScene(story, "a", "bad id"), /씬 ID/);
  assert.throws(() => renameScene(story, "missing", "x"));
});

test("renaming a character moves speakers, actor placements and asset ownership", () => {
  const staged: VnScript = { ...story, scenes: story.scenes.map(row => row.id === "a" ? { ...row, sprites: [{ slot: "left", character: "hero", expression: "neutral" }], lines: row.lines.map(line => line.speaker === "hero" ? { ...line, sprites: [{ slot: "right", character: "hero" }] } : line) } : row), assets: [{ ...story.assets![0]!, kind: "character", characterId: "hero", expression: "neutral" }] };
  const renamed = renameCharacter(staged, "hero", "seoha");
  assert.equal(renamed.characters[0]!.id, "seoha"); assert.equal(renamed.characters[0]!.name, "주인공");
  assert.equal(renamed.scenes[0]!.lines[1]!.speaker, "seoha");
  assert.equal(renamed.scenes[0]!.sprites![0]!.character, "seoha");
  assert.equal(renamed.scenes[0]!.lines[1]!.sprites![0]!.character, "seoha");
  assert.equal(renamed.scenes[1]!.lines[0]!.speaker, "seoha");
  assert.equal(renamed.assets![0]!.characterId, "seoha");
  assert.throws(() => renameCharacter(story, "hero", "1bad"));
  assert.throws(() => renameCharacter({ ...story, characters: [...story.characters, { id: "taken", name: "x", color: "#000000", bio: "" }] }, "hero", "taken"), /사용 중/);
});

test("renaming a state variable updates defaults, conditions and choice effects together", () => {
  const renamed = renameFlag(story, "trust", "bond");
  assert.deepEqual(renamed.flags, { bond: 0, letter: false });
  assert.deepEqual(renamed.scenes[0]!.choices![0]!.add, { bond: 1 });
  assert.equal(renamed.scenes[0]!.choices![1]!.when!.compare![0]!.flag, "bond");
  const letter = renameFlag(renamed, "letter", "has_letter");
  assert.deepEqual(letter.scenes[0]!.choices![0]!.set, { has_letter: true });
  assert.deepEqual(letter.scenes[1]!.lines[0]!.when!.all, ["has_letter"]);
  assert.throws(() => renameFlag(story, "trust", "letter"), /사용 중/);
  assert.throws(() => renameFlag(story, "trust", "__proto__"));
  assert.throws(() => renameFlag(story, "nope", "x"));
});

test("the edit guard refuses manuscripts the parser would reject and stays cheap for single-scene text edits", () => {
  const long = "가".repeat(LIMITS.text + 1);
  const overLimit: VnScript = { ...story, scenes: story.scenes.map(row => row.id === "a" ? { ...row, lines: row.lines.map((line, index) => index === 0 ? { ...line, text: long } : line) } : row) };
  assert.match(editIssue(story, overLimit)!, /대사/);
  assert.equal(editIssue(story, { ...story, scenes: story.scenes.map(row => row.id === "a" ? { ...row, lines: row.lines.map((line, index) => index === 0 ? { ...line, text: "짧은 수정" } : line) } : row) }), null);
  assert.match(editIssue(story, { ...story, scenes: story.scenes.map(row => row.id === "a" ? { ...row, chapter: long } : row) })!, /chapter|텍스트/);
  const many: VnScript = { ...story, scenes: Array.from({ length: LIMITS.scenes + 1 }, (_, index) => scene(`s${index}`, { ending: "끝" })) };
  assert.match(editIssue(story, many)!, /최대 300개/);
  const tooManyLines: VnScript = { ...story, scenes: story.scenes.map(row => row.id === "a" ? { ...row, lines: Array.from({ length: LIMITS.sceneLines + 1 }, (_, index) => ({ speaker: null, text: `줄 ${index}` })) } : row) };
  assert.match(editIssue(story, tooManyLines)!, /2,000줄/);
  assert.match(editIssue(story, { ...story, title: "   " })!, /제목/);
  assert.match(editIssue(story, { ...story, characters: [], scenes: story.scenes })!, /화자/, "structural edits run the full parser");
  assert.equal(editIssue(story, story), null);
});

test("media references are collected once per url with a location label, and only 404s count as missing", async () => {
  const refs = collectMediaReferences(story);
  assert.deepEqual(refs.map(ref => ref.kind), ["background", "voice", "portrait", "artwork"].filter((_, index) => index < 3).concat([]).length === 3 ? ["background", "voice", "portrait"] : refs.map(ref => ref.kind));
  assert.equal(refs.filter(ref => ref.url === "/assets/art/rain-library.png").length, 1, "the artwork entry shares its url with scene a and is deduplicated");
  assert.equal(refs[0]!.sceneId, "a"); assert.match(refs[0]!.label, /장면 배경/);
  assert.equal(refs[1]!.sceneId, "b"); assert.match(refs[1]!.label, /1줄 보이스/);
  assert.equal(refs[2]!.sceneId, undefined); assert.match(refs[2]!.label, /주인공 · neutral/);
  const seen: string[] = [];
  const fetcher = async (url: string) => { seen.push(url); return new Response(null, { status: url.includes("2".repeat(64)) ? 404 : 200 }); };
  const result = await findMissingMedia(refs, { fetcher, ensureUserAssets: async () => {} });
  assert.deepEqual(result.missing.map(ref => ref.kind), ["voice"]);
  assert.deepEqual(result.available.sort(), ["/assets/art/rain-library.png", "/assets/user/" + "1".repeat(64) + ".png"]);
  const cached = await findMissingMedia(refs, { fetcher: async () => { throw new Error("must not fetch"); }, known: new Set(refs.map(ref => ref.url)) });
  assert.deepEqual(cached.missing, []);
  const offline = await findMissingMedia(refs, { fetcher: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(offline.missing, [], "network failures are unknown, not missing");
  const noWorker = await findMissingMedia(refs, { fetcher: async () => new Response(null, { status: 404 }), ensureUserAssets: async () => { throw new Error("no sw"); } });
  assert.deepEqual(noWorker.missing.map(ref => ref.url), ["/assets/art/rain-library.png"], "user files are skipped when the asset worker is unavailable");
});

test("withNarrativeIds skips scenes that are unchanged from the previous manuscript", () => {
  let calls = 0; const id = () => `id-${++calls}`;
  const base = withNarrativeIds({ ...story, scenes: story.scenes.map(row => ({ ...row, lines: row.lines.map(({ id: _id, ...line }) => line) })) }, id);
  const before = calls;
  const edited = { ...base, scenes: base.scenes.map((row, index) => index === 0 ? { ...row, lines: [...row.lines, { speaker: null, text: "새 줄" }] } : row) };
  const next = withNarrativeIds(edited, id, base);
  assert.equal(calls, before + 1);
  assert.equal(next.scenes[1], base.scenes[1]);
  assert.ok(next.scenes[0]!.lines[2]!.id);
  const full = withNarrativeIds(edited, id);
  assert.deepEqual(full.scenes.map(row => row.lines.map(line => typeof line.id)), next.scenes.map(row => row.lines.map(line => typeof line.id)), "fast path assigns identities everywhere the full pass does");
  assert.deepEqual(parseScript(JSON.parse(JSON.stringify(next))), next);
});
