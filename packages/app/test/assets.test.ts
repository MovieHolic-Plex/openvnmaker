import assert from "node:assert/strict";
import { test } from "node:test";
import { script, parseScript, validBackgroundUrl, type Artwork, type VnScript } from "@vnmaker/content";
import { applyArtwork, artPrompt, assetUsage, createGeneratedArtwork, libraryAssets, pendingArtScenes, registerArtwork } from "../src/studio/assets.js";

const base: VnScript = { title: "이미지 테스트", subtitle: "", start: "first", characters: script.characters, scenes: [{ id: "first", background: "title", lines: [{ speaker: "seorin", text: "비가 온다." }], sprites: [{ slot: "center", character: "seorin", expression: "smile" }], next: "last" }, { id: "last", background: "campus-cafe", lines: [{ speaker: null, text: "돌아왔다." }], ending: "끝" }] };
const cg: Artwork = { id: "event", name: "빗속의 고백", kind: "cg", url: "/assets/art/rain-confession-cg.png", sceneId: "first" };
const background: Artwork = { id: "night", name: "밤", kind: "background", url: "/api/image/file/night.png" };

test("art parser accepts local artwork roots and rejects URL traversal, remote URLs, SVG and query strings", () => {
  for (const url of [cg.url, background.url, "/assets/sprite/seorin-smile.png", "/assets/art/custom/subdir/image-1.webp"]) assert.equal(validBackgroundUrl(url), true, url);
  for (const url of ["https://example.com/img.png", "//example.com/img.png", "/assets/../secret.png", "/assets/a/../../secret.png", "/assets/%2e%2e/secret.png", "/assets/art/img.svg", "/assets/art/img.png?tracking=1", "/api/image/file/../../image.png", "data:image/png;base64,aA=="]) assert.equal(validBackgroundUrl(url), false, url);
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], cgUrl: "https://example.com/image.png" }, base.scenes[1]] }), /CG 주소/);
  assert.throws(() => parseScript({ ...base, assets: [{ ...cg, url: "/assets/art/bad.svg" }] }), /에셋 이미지 주소/);
});

test("line background cues survive project serialization and reject unsafe or non-string image URLs", () => {
  const withCue = { ...base, scenes: [{ ...base.scenes[0], lines: [{ speaker: null, text: "장소 전환", backgroundUrl: "/assets/art/rain-library.png" }] }, base.scenes[1]] };
  const restored = parseScript(JSON.parse(JSON.stringify(withCue)));
  assert.equal(restored.scenes[0]?.lines[0]?.backgroundUrl, "/assets/art/rain-library.png");
  for (const backgroundUrl of ["https://example.com/track.png", "/assets/../private.png", "/api/image/file/image.png?extra=1", "", null, 42]) {
    assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], lines: [{ speaker: null, text: "장소 전환", backgroundUrl }] }, base.scenes[1]] }), /대사 배경 주소/);
  }
});

test("CG assignment survives parsing/export and preserves dialogue, sprites and story exits", () => {
  const next = applyArtwork(base, "first", cg);
  const roundtrip = parseScript(JSON.parse(JSON.stringify(next)));
  assert.equal(roundtrip.scenes[0]?.cgUrl, cg.url);
  assert.equal(roundtrip.scenes[0]?.framing, "cinematic");
  assert.equal(roundtrip.scenes[0]?.next, "last");
  assert.deepEqual(roundtrip.scenes[0]?.lines, base.scenes[0]?.lines);
  assert.deepEqual(roundtrip.scenes[0]?.sprites, base.scenes[0]?.sprites);
  assert.equal(assetUsage(roundtrip, cg), 1);
  assert.equal(base.assets, undefined);
  assert.equal(base.scenes[0]?.cgUrl, undefined);
});

test("applying a background leaves event-CG mode so the player's character layer returns", () => {
  const next = applyArtwork(applyArtwork(base, "first", cg), "first", background);
  assert.equal(next.scenes[0]?.backgroundUrl, background.url);
  assert.equal(next.scenes[0]?.cgUrl, undefined);
  assert.equal(next.assets?.length, 2);
  assert.deepEqual(next.scenes[0]?.sprites, base.scenes[0]?.sprites);
});

test("character art changes one expression without replacing other characters or expressions", () => {
  const neutral: Artwork = { id: "neutral", name: "기본", kind: "character", url: "/api/image/file/neutral.png", characterId: "seorin", expression: "neutral" };
  const smile: Artwork = { ...neutral, id: "smile", name: "웃음", expression: "smile", url: "/api/image/file/smile.webp" };
  const next = applyArtwork(applyArtwork(base, "first", neutral), "first", smile);
  assert.deepEqual(next.characters.find(character => character.id === "seorin")?.expressionImages, { ...base.characters.find(character => character.id === "seorin")?.expressionImages, neutral: neutral.url, smile: smile.url });
  assert.deepEqual(next.characters.find(character => character.id === "dohyun")?.expressionImages, base.characters.find(character => character.id === "dohyun")?.expressionImages);
  assert.throws(() => parseScript({ ...base, characters: [{ ...base.characters[0], expressionImages: { neutral: "https://example.com/track.png" } }] }), /캐릭터 이미지 주소/);
  assert.throws(() => parseScript({ ...base, characters: [{ ...base.characters[0], expressionImages: { angry: neutral.url } }] }), /표정/);
});

test("art registry rejects duplicate IDs and invalid scene/character references", () => {
  assert.throws(() => parseScript({ ...base, assets: [cg, cg] }), /중복/);
  assert.throws(() => parseScript({ ...base, assets: [{ ...cg, sceneId: "missing" }] }), /대상 씬/);
  assert.throws(() => parseScript({ ...base, assets: [{ ...cg, kind: "character" }] }), /등장인물/);
  assert.equal(registerArtwork(registerArtwork(base, cg), { ...cg, name: "수정" }).assets?.length, 1);
});

test("batch art planning resumes from stored results and does not regenerate completed scenes", () => {
  assert.deepEqual(pendingArtScenes(base).map(scene => scene.id), ["first", "last"]);
  const saved = registerArtwork(base, cg);
  assert.deepEqual(pendingArtScenes(saved).map(scene => scene.id), ["last"]);
  assert.deepEqual(saved.scenes, base.scenes, "Saving a proposal must not silently apply it to playback.");
  assert.equal(libraryAssets(saved).filter(asset => asset.id === cg.id).length, 1);
});

test("generation includes art bible and scene brief and rejects malformed server image URLs", () => {
  const prompt = artPrompt({ ...base, artDirection: "청보라색 밤과 앰버 조명." }, base.scenes[0]!, "cg", "고백하는 순간.");
  assert.ok(prompt.includes("청보라색 밤과 앰버 조명."));
  assert.ok(prompt.includes("고백하는 순간."));
  assert.ok(prompt.includes("event CG"));
  assert.throws(() => createGeneratedArtwork("cg", base.scenes[0]!, { url: "https://example.com/art.png", name: "" }, prompt), /파일 주소/);
  const result = createGeneratedArtwork("cg", base.scenes[0]!, { url: "/api/image/file/generated.png", name: "generated.png" }, prompt);
  assert.equal(result.sceneId, "first");
  assert.equal(result.prompt, prompt);
});
