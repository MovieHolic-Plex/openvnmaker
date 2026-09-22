import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, parseScript, type Scene, type VnScript } from "@vnmaker/content";
import { duplicateLine, insertLines, moveLine, removeLine, splitPastedText } from "../src/studio/lineOperations.js";
import { findText, replaceAll, replaceInMatch } from "../src/studio/findReplace.js";
import { appendChoice, directSceneExit, duplicateScene, insertSceneAfter, renameScene } from "../src/studio/sceneOperations.js";
import { renameCharacter } from "../src/studio/characterOperations.js";
import { referencedFlags, renameFlag } from "../src/studio/stateOperations.js";
import { mergeActorCue } from "../src/studio/lineOperations.js";
import { previewFlagsFor } from "../src/studio/editorPosition.js";
import { audioInUse } from "../src/studio/assets.js";
import { layoutStoryMap } from "../src/studio/StoryMap.js";
import { unrecognizedSpeakers } from "../src/studio/lineOperations.js";
import { unreferencedUserAssets } from "../src/studio/assetCleanup.js";
import { reduce } from "../src/engine/reducer.js";
import { initialState } from "../src/engine/types.js";
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
  const withTitleMusic = collectMediaReferences({ ...story, titleBgm: "/assets/user/" + "a".repeat(64) + ".mp3" });
  assert.ok(withTitleMusic.some(ref => ref.url.endsWith("a".repeat(64) + ".mp3")), "title BGM is collected too");
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

test("switching an actor drops the previous actor's outfit and expression so the script stays parseable", () => {
  const portrait = (hex: string) => `/assets/user/${hex.repeat(64)}.png`;
  const staged = parseScript({ ...story, characters: [
    { id: "hero", name: "주인공", color: "#aabbcc", bio: "", outfits: ["offduty"], expressionImages: { neutral: portrait("1"), wink: portrait("2") } },
    { id: "riho", name: "리호", color: "#ccbbaa", bio: "", expressionImages: { neutral: portrait("3") } },
    { id: "mia", name: "미아", color: "#ccbbaa", bio: "", outfits: ["offduty"], expressionImages: { neutral: portrait("4"), wink: portrait("5") } },
  ], scenes: [scene("a", { lines: [{ speaker: null, text: "큐", sprites: [{ slot: "left", character: "hero", outfit: "offduty", expression: "wink" }] }] }), story.scenes[1]!] });
  const switched = mergeActorCue(staged, staged.scenes[0]!, 0, "left", { character: "riho", poseUrl: null });
  assert.deepEqual(switched.sprites, [{ slot: "left", character: "riho", poseUrl: null }], "outfit/custom expression do not follow the old actor");
  const applied = { ...staged, scenes: [{ ...staged.scenes[0]!, lines: [switched] }, staged.scenes[1]!] };
  assert.doesNotThrow(() => parseScript(applied));
  const compatible = mergeActorCue(staged, staged.scenes[0]!, 0, "left", { character: "mia" });
  assert.equal(compatible.sprites![0]!.outfit, "offduty", "a valid outfit on the new actor survives");
  assert.equal(compatible.sprites![0]!.expression, "wink");
  const left = mergeActorCue(staged, staged.scenes[0]!, 0, "left", { character: null, poseUrl: null });
  assert.equal(left.sprites![0]!.character, null);
  const kept = mergeActorCue(staged, staged.scenes[0]!, 0, "left", { expression: "neutral" });
  assert.equal(kept.sprites![0]!.outfit, "offduty", "same-actor patches keep the outfit");
});

test("inserting a scene moves the exit to the new scene without copying set/cg/brief, and play reaches it", () => {
  const routed = parseScript({ ...story, scenes: [
    scene("a", { set: { trust: 9 }, cgUrl: "/assets/art/rain-library.png", artBrief: "이 장면만의 메모", routes: [{ when: { all: ["letter"] }, next: "b" }], next: "b" }),
    scene("b", { ending: "끝" }),
  ] });
  const { script: inserted, movedExit } = insertSceneAfter(routed, routed.scenes[0]!, "mid");
  assert.equal(movedExit, "조건 연결");
  const [before, mid] = inserted.scenes;
  assert.equal(before!.next, "mid");
  assert.equal(before!.routes, undefined, "routes move to the inserted scene — leaving them would skip it at runtime");
  assert.equal(before!.set?.trust, 9, "the original scene keeps its own entry state");
  assert.deepEqual(mid!.routes, routed.scenes[0]!.routes);
  assert.equal(mid!.next, "b", "the route fallback travels with the routes");
  assert.equal(mid!.set, undefined, "entry flag writes are not duplicated");
  assert.equal(mid!.cgUrl, undefined); assert.equal(mid!.artBrief, undefined);
  assert.equal(mid!.background, routed.scenes[0]!.background, "stage look carries over");
  assert.doesNotThrow(() => parseScript(inserted));
  // letter=false 이면 경로가 안 맞아도 폴백으로 b 에 도착 — 새 장면을 반드시 거친다.
  let state = reduce(inserted, initialState(inserted), { type: "start" });
  state = reduce(inserted, state, { type: "advance" });
  state = reduce(inserted, state, { type: "advance" });
  assert.equal(state.sceneId, "mid");
  state = reduce(inserted, state, { type: "advance" });
  assert.equal(state.sceneId, "b");
  state = reduce(inserted, state, { type: "advance" });
  state = reduce(inserted, state, { type: "advance" });
  assert.equal(state.phase, "ending");
});

test("direct exits and added choices clear stale routes so the chosen exit is not preempted", () => {
  const routed = parseScript({ ...story, scenes: [scene("a", { routes: [{ when: { all: ["letter"] }, next: "b" }], next: "b" }), scene("b", { ending: "끝" })] });
  const ended = directSceneExit(routed.scenes[0]!, "ending");
  assert.equal(ended.routes, undefined); assert.equal(ended.ending, "a 장");
  const linked = directSceneExit(routed.scenes[0]!, "b");
  assert.equal(linked.next, "b"); assert.equal(linked.routes, undefined);
  // 런타임이 고른 출구를 실제로 따른다 — letter=true 인데도 엔딩에 도착해야 한다.
  const applied = parseScript({ ...routed, scenes: [ended, routed.scenes[1]!] });
  let state = reduce(applied, { ...initialState(applied), flags: { letter: true } }, { type: "start" });
  state = reduce(applied, state, { type: "advance" }); state = reduce(applied, state, { type: "advance" });
  assert.equal(state.phase, "ending");
  const withChoice = appendChoice(routed.scenes[0]!, "b");
  assert.equal(withChoice.routes, undefined); assert.equal(withChoice.choices!.length, 1);
});

test("referencedFlags covers scene entry sets, route conditions and input targets", () => {
  const rich = parseScript({ ...story, flags: { trust: 0, letter: false, player_name: "", route_flag: false }, scenes: [scene("a", {
    set: { trust: 1 }, routes: [{ when: { all: ["route_flag"] }, next: "b" }],
    lines: [{ speaker: null, text: "입력", input: { flag: "player_name" } }, { speaker: null, text: "조건 줄", when: { none: ["line_flag"] } }],
    choices: [{ text: "x", next: "b", set: { choice_set: true }, when: { compare: [{ flag: "choice_when", op: "eq", value: true }] } }],
  }), scene("b", { ending: "끝" })] });
  const refs = referencedFlags(rich);
  for (const key of ["trust", "route_flag", "player_name", "line_flag", "choice_set", "choice_when"]) assert.ok(refs.has(key), `${key} should count as referenced`);
  assert.equal(refs.has("letter"), false);
  const renamed = renameFlag(rich, "player_name", "reader");
  assert.equal(renamed.scenes[0]!.lines[0]!.input!.flag, "reader", "renaming a variable retargets input writes too");
  assert.equal(renameFlag(rich, "route_flag", "r").scenes[0]!.routes![0]!.when!.all![0], "r");
});

test("preview flags apply the current scene's entry set without crediting unvisited scenes", () => {
  const staged = parseScript({ ...story, scenes: [
    scene("a", { set: { trust: 7 }, lines: [{ speaker: null, text: "a" }], next: "b" }),
    scene("b", { set: { letter: true }, lines: [{ speaker: null, text: "b" }], ending: "끝" }),
  ] });
  assert.deepEqual(previewFlagsFor(staged, {}, "a"), { trust: 7, letter: false }, "editing scene a sees its entry set");
  assert.deepEqual(previewFlagsFor(staged, {}, "b"), { trust: 0, letter: true }, "a later scene's set does not leak backwards");
});

test("title BGM counts as an audio usage and undo history keeps card files alive", () => {
  const url = "/assets/user/" + "3".repeat(64) + ".mp3";
  const withTitle = parseScript({ ...story, titleBgm: url });
  assert.equal(audioInUse(withTitle, url), true, "title BGM must block removal");
  assert.equal(audioInUse(story, url), false);
  const withAsset = parseScript({ ...story, audioAssets: [{ id: "au-1", name: "곡", kind: "bgm", url, duration: 120 }] });
  const afterRemoval = { ...withAsset, audioAssets: [] };
  // 삭제 후 원고만 보면 미참조지만, 실행 취소 이력(삭제 전 원고)에 남아 있으면 파일을 지우지 않는다.
  assert.deepEqual(unreferencedUserAssets([url], [afterRemoval]), [url]);
  assert.deepEqual(unreferencedUserAssets([url], [afterRemoval, withAsset]), []);
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

test("renameFlag rewrites {flag:…}/{player} tokens in text, input prompt, and character names", () => {
  const withTokens = parseScript({
    ...story,
    flags: { player: "" },
    characters: [{ id: "friend", name: "{player}의 친구", color: "#aabbcc", bio: "" }],
    scenes: [{ id: "a", background: "title", lines: [
      { speaker: null, text: "안녕 {player}, {flag:player}!", input: { flag: "player", prompt: "{player}의 이름은?", placeholder: "{flag:player}" } },
    ], choices: [{ text: "{player}이(가) 간다", next: "a" }] }],
  });
  const next = renameFlag(withTokens, "player", "hero");
  const line = next.scenes[0]!.lines[0]!;
  assert.equal(line.text, "안녕 {flag:hero}, {flag:hero}!");
  assert.equal(line.input!.flag, "hero");
  assert.equal(line.input!.prompt, "{flag:hero}의 이름은?");
  assert.equal(line.input!.placeholder, "{flag:hero}");
  assert.equal(next.scenes[0]!.choices![0]!.text, "{flag:hero}이(가) 간다");
  assert.equal(next.characters[0]!.name, "{flag:hero}의 친구");
});

test("renameFlag refuses a rename that would collide inside one set/add map", () => {
  const collide = parseScript({ ...story, flags: { met: false }, scenes: [
    scene("a", { set: { met: true, night: 1 }, ending: "e" }),
  ] });
  assert.throws(() => renameFlag(collide, "met", "night"), /함께 쓰고 있어|겹치는/);
  const fine = parseScript({ ...story, flags: { met: false, night: 0 }, scenes: [
    scene("a", { set: { met: true }, next: "b" }), scene("b", { set: { night: 2 }, ending: "e" }),
  ] });
  assert.doesNotThrow(() => renameFlag(fine, "met", "warmth"), "renames into a name absent from every set/add map still work");
});

test("pasted 'name:' prefixes bind only to unambiguous characters — duplicates stay narration", () => {
  const twins = [
    { id: "twin-a", name: "서린", color: "#aabbcc", bio: "" },
    { id: "twin-b", name: "서린", color: "#bbccdd", bio: "" },
  ];
  const lines = splitPastedText("서린: 안녕\n도현: 둘째", twins);
  assert.equal(lines[0]!.speaker, null, "ambiguous name is not bound to an arbitrary twin");
  assert.equal(lines[0]!.text, "서린: 안녕");
  assert.ok(unrecognizedSpeakers("서린: 안녕", twins).includes("서린"), "the ambiguity is reported");
});

test("find/replace reaches prompts, placeholders, chapter and ending titles, and speaker names", () => {
  const wide = parseScript({ ...story,
    characters: [...story.characters, { id: "secret-npc", name: "비밀 서린", color: "#aabbcc", bio: "" }],
    scenes: [
      { ...scene("a", { chapter: "비밀의 장" }), lines: [{ speaker: null, text: "입력", input: { flag: "player", prompt: "비밀은?", placeholder: "비밀" } }], next: "b" },
      scene("b", { ending: "비밀 엔딩" }),
    ] });
  const hits = findText(wide, "비밀");
  assert.deepEqual(hits.map(h => h.kind).sort(), ["chapter", "ending", "name", "placeholder", "prompt"]);
  const swapped = replaceAll(wide, "비밀", "약속");
  assert.equal(swapped.script.scenes[0]!.lines[0]!.input!.prompt, "약속은?");
  assert.equal(swapped.script.scenes[0]!.chapter, "약속의 장");
  assert.equal(swapped.script.scenes[1]!.ending, "약속 엔딩");
  assert.equal(swapped.script.characters.find(c => c.id === "secret-npc")!.name, "약속 서린");
});

test("replaceInMatch relocates by the recorded text when the stored index went stale", () => {
  const match = findText(story, "편지").find(m => m.kind === "line")!;
  const shifted: VnScript = { ...story, scenes: story.scenes.map(s => s.id === match.sceneId ? { ...s, lines: [{ speaker: null, text: "새 줄" }, ...s.lines] } : s) };
  const replaced = replaceInMatch(shifted, match, "편지", "쪽지");
  assert.ok(replaced.scenes.some(s => s.lines.some(l => l.text.includes("쪽지"))), "the intended line was found and rewritten");
});

test("insertSceneAfter keeps a routes+ending source scene's ending as the inserted scene's fallback", () => {
  const src = parseScript({ ...story, scenes: [
    scene("a", { routes: [{ when: { all: ["letter"] }, next: "b" }], ending: "낮 엔딩" }),
    scene("b", { ending: "밤 엔딩" }),
  ] });
  const { script: next, movedExit } = insertSceneAfter(src, src.scenes[0]!, "mid");
  assert.equal(movedExit, "조건 연결");
  assert.equal(next.scenes[1]!.ending, "낮 엔딩", "the fallback ending travels with the routes");
  assert.doesNotThrow(() => parseScript(next));
});

test("story map keeps unreachable scenes in bounded bands instead of a quadratic stack", () => {
  const crowded = parseScript({ ...story, scenes: [
    ...story.scenes,
    ...Array.from({ length: 40 }, (_, i) => scene(`loose-${i}`, { ending: `e${i}` })),
  ] });
  const { width, height } = layoutStoryMap(crowded);
  assert.ok(height < 4000 && width < 8000, `${width}x${height} — unreachable rows stay grouped`);
});
