/**
 * losia 매니페스트 → 프로젝트 아트/a음원 설치 계획.
 *
 * 잡는 결함:
 * - embedded 등급은 원본을 배포하지 않는다 — 설치 계획 단계에서 막지 않으면 빈 URL 이 원고에 들어간다.
 * - losia 표정 role 은 한글(`expression:슬픔`)이다. vnmaker 표정 키는 영문 slug 라 그대로 넣으면 parse 가 거부한다.
 * - 저장되지 않은 파일을 가리키는 Artwork 를 등록하면 플레이어에서 빈 이미지가 된다.
 * - 같은 자산을 다시 설치하면 중복 카드가 쌓인다 → id 가 안정적이어야 한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MediaProvenance } from "@vnmaker/content";
import { artworksFromInstall, installPlan, parseStoreManifest, StoreInstallError, type StoreManifest } from "../src/studio/storeInstall.js";

const stage: StoreManifest = {
  spec: "losia-asset/1",
  id: "stb33826d1890f",
  kind: "stage",
  name: "부엌 · 낮",
  tags: ["부엌", "낮", "흐림"],
  license: "downloadable",
  uploader: { handle: "losia", display: "Losia" },
  provenance: { generator: "codex", model: "gpt-5.6-terra", prompt: "부엌 배경" },
  files: [
    { role: "base", url: "https://losia.online/api/assets/stb33826d1890f/files/base", mime: "image/png" },
    { role: "variant:밤", url: "https://losia.online/api/assets/stb33826d1890f/files/variant%3A%EB%B0%A4" },
  ],
};

test("spec 이 다르면 설치하지 않는다", () => {
  assert.throws(() => parseStoreManifest({ ...stage, spec: "losia-asset/2" }), StoreInstallError);
  assert.throws(() => parseStoreManifest({ ...stage, kind: "weapon" }), StoreInstallError);
  assert.throws(() => parseStoreManifest({ ...stage, files: [] }), StoreInstallError);
  assert.throws(() => parseStoreManifest({ ...stage, license: "unknown" }), StoreInstallError);
});

test("embedded 등급은 설치 계획을 세우지 않는다", () => {
  const embedded: StoreManifest = { ...stage, license: "embedded", files: [{ role: "base" }] };
  assert.throws(() => installPlan(embedded), (error: unknown) => error instanceof StoreInstallError && /embedded/.test(error.message));
});

test("url 없는 파일은 조용히 건너뛰지 않고 오류로 보고한다", () => {
  const broken: StoreManifest = { ...stage, license: "attribution", files: [{ role: "base" }] };
  assert.throws(() => installPlan(broken), StoreInstallError);
});

test("무대 자산은 base + 변형을 각각 배경 후보로 만든다", () => {
  const plan = installPlan(stage);
  assert.deepEqual(plan.ignored, []);
  assert.equal(plan.files.length, 2);
  assert.deepEqual(plan.files[0], { role: "base", kind: "background", name: "부엌 · 낮", mime: "image/png" });
  assert.deepEqual(plan.files[1], { role: "variant:밤", kind: "background", name: "부엌 · 낮 · 밤" });
});

test("모르는 role 은 무시하되 목록에 남긴다", () => {
  const plan = installPlan({ ...stage, files: [...stage.files, { role: "wireframe", url: "https://losia.online/api/assets/stb33826d1890f/files/wireframe" }] });
  assert.equal(plan.files.length, 2);
  assert.deepEqual(plan.ignored, ["wireframe"]);
});

test("인물 자산의 한글 표정은 vnmaker 표정 키로 옮기고 라벨은 남긴다", () => {
  const character: StoreManifest = {
    ...stage, id: "ch1234567890ab", kind: "character", name: "이서린", files: [
      { role: "base", url: "https://losia.online/api/assets/ch1234567890ab/files/base" },
      { role: "expression:슬픔", url: "https://losia.online/api/assets/ch1234567890ab/files/sad" },
      { role: "expression:미소", url: "https://losia.online/api/assets/ch1234567890ab/files/smile" },
      { role: "expression:부끄러움", url: "https://losia.online/api/assets/ch1234567890ab/files/shy" },
      { role: "expression:초조함", url: "https://losia.online/api/assets/ch1234567890ab/files/fidget" },
      { role: "pose:상반신", url: "https://losia.online/api/assets/ch1234567890ab/files/pose" },
      { role: "cg", url: "https://losia.online/api/assets/ch1234567890ab/files/cg" },
    ],
  };
  const plan = installPlan(character);
  const byRole = new Map(plan.files.map(row => [row.role, row]));
  assert.equal(byRole.get("expression:슬픔")?.expression, "sad");
  assert.equal(byRole.get("expression:슬픔")?.label, "슬픔");
  assert.equal(byRole.get("expression:미소")?.expression, "smile");
  assert.equal(byRole.get("expression:부끄러움")?.expression, "shy");
  assert.equal(byRole.get("expression:부끄러움")?.label, "부끄러움");
  assert.match(byRole.get("expression:초조함")?.expression ?? "", /^x-[a-z0-9]+$/);
  assert.equal(byRole.get("expression:초조함")?.label, "초조함");
  assert.equal(byRole.get("base")?.kind, "character");
  assert.equal(byRole.get("pose:상반신")?.kind, "character");
  assert.equal(byRole.get("pose:상반신")?.expression, undefined);
  assert.equal(byRole.get("cg")?.kind, "cg");
});

test("소리 자산은 태그로 bgm/sfx 를 가른다", () => {
  const sound: StoreManifest = { ...stage, id: "so1234567890ab", kind: "sound", name: "문 열림", tags: ["효과음"], files: [{ role: "audio", url: "https://losia.online/api/assets/so1234567890ab/files/audio" }] };
  assert.equal(installPlan(sound).files[0]?.audioKind, "sfx");
  assert.equal(installPlan({ ...sound, tags: ["배경음"] }).files[0]?.audioKind, "bgm");
});

test("저장된 파일만 Artwork 로 만들고, 빠진 파일이 있으면 등록하지 않는다", () => {
  const plan = installPlan(stage);
  const stored = new Map([["base", "/assets/user/aaaa.png"], ["variant:밤", "/assets/user/bbbb.png"]]);
  const { artworks, audio } = artworksFromInstall(stage, plan, stored, {});
  assert.equal(audio.length, 0);
  assert.deepEqual(artworks.map(row => row.url), ["/assets/user/aaaa.png", "/assets/user/bbbb.png"]);
  assert.deepEqual(artworks.map(row => row.kind), ["background", "background"]);
  assert.deepEqual(artworks.map(row => row.name), ["부엌 · 낮", "부엌 · 낮 · 밤"]);

  const partial = new Map([["base", "/assets/user/aaaa.png"]]);
  assert.throws(() => artworksFromInstall(stage, plan, partial, {}), (error: unknown) => error instanceof StoreInstallError && /저장/.test(error.message));
});

test("출처·라이선스가 원고에 남는다", () => {
  const plan = installPlan(stage);
  const stored = new Map(plan.files.map(row => [row.role, "/assets/user/hash.png"]));
  const [artwork] = artworksFromInstall({ ...stage, license: "attribution" }, plan, stored, {}).artworks;
  assert.deepEqual(artwork?.provenance, { creator: "Losia", source: "https://losia.online/api/assets/stb33826d1890f", license: "attribution", credit: "Losia · losia.online" });
  assert.equal(artwork?.prompt, "부엌 배경");
});

test("같은 자산을 두 번 설치해도 id 가 같다(중복 카드가 쌓이지 않는다)", () => {
  const plan = installPlan(stage);
  const stored = new Map(plan.files.map(row => [row.role, "/assets/user/hash.png"]));
  const first = artworksFromInstall(stage, plan, stored, {}).artworks;
  const second = artworksFromInstall(stage, plan, stored, {}).artworks;
  assert.deepEqual(first.map(row => row.id), second.map(row => row.id));
  assert.equal(new Set(first.map(row => row.id)).size, first.length);
  assert.ok(first.every(row => /^losia-/.test(row.id)));
});

test("인물 자산은 캐릭터를 고르지 않으면 등록하지 않는다", () => {
  const character: StoreManifest = { ...stage, id: "ch1234567890ab", kind: "character", name: "이서린", files: [{ role: "expression:미소", url: "https://losia.online/api/assets/ch1234567890ab/files/smile" }] };
  const plan = installPlan(character);
  const stored = new Map([["expression:미소", "/assets/user/hash.png"]]);
  assert.throws(() => artworksFromInstall(character, plan, stored, {}), StoreInstallError);
  const { artworks } = artworksFromInstall(character, plan, stored, { characterId: "seorin" });
  assert.equal(artworks[0]?.characterId, "seorin");
  assert.equal(artworks[0]?.expression, "smile");
});

test("소리 자산은 재생 길이와 함께 AudioAsset 이 된다", () => {
  const sound: StoreManifest = { ...stage, id: "so1234567890ab", kind: "sound", name: "문 열림", tags: ["효과음"], files: [{ role: "audio", url: "https://losia.online/api/assets/so1234567890ab/files/audio", mime: "audio/ogg" }] };
  const plan = installPlan(sound);
  const { artworks, audio } = artworksFromInstall(sound, plan, new Map([["audio", "/assets/user/sound.ogg"]]), {}, new Map([["audio", 3.5]]));
  assert.equal(artworks.length, 0);
  assert.deepEqual(audio.map(row => ({ kind: row.kind, url: row.url, duration: row.duration })), [{ kind: "sfx", url: "/assets/user/sound.ogg", duration: 3.5 }]);
  assert.ok(audio[0]?.provenance && (audio[0].provenance as MediaProvenance).source?.includes("losia.online"));
});

test("매니페스트 경계 — 비정상적으로 긴 필드와 파일 수는 거부한다", () => {
  assert.throws(() => parseStoreManifest({ ...stage, id: "x".repeat(201) }), StoreInstallError);
  assert.throws(() => parseStoreManifest({ ...stage, name: "x".repeat(201) }), StoreInstallError);
  assert.throws(() => parseStoreManifest({ ...stage, files: [{ role: "r".repeat(201), url: "https://losia.online/x" }] }), StoreInstallError);
  assert.throws(() => parseStoreManifest({ ...stage, files: Array.from({ length: 65 }, (_, i) => ({ role: `f${i}`, url: "https://losia.online/x" })) }), StoreInstallError);
});

test("chromaKey 는 대문자를 정규화하고 #00ff00 이 아니면 필드를 버린다", () => {
  assert.equal(parseStoreManifest({ ...stage, chromaKey: "#00FF00" }).chromaKey, "#00ff00");
  // 다른 색은 파서가 거절할 값이므로 저장 전에 조용히 버린다 — 통과시키면 설치가 parseScript 에서 터진다.
  assert.equal(parseStoreManifest({ ...stage, chromaKey: "#ff0000" }).chromaKey, undefined);
  assert.equal(parseStoreManifest({ ...stage, chromaKey: "green" }).chromaKey, undefined);
});

test("업로더·생성 정보는 문자열 필드만 일정 길이로 잘라 담는다", () => {
  const parsed = parseStoreManifest({ ...stage, uploader: { handle: 7, display: "표시" }, provenance: { generator: "gen", prompt: 12 } });
  assert.deepEqual(parsed.uploader, { display: "표시" });
  assert.deepEqual(parsed.provenance, { generator: "gen" });
  assert.equal(parseStoreManifest({ ...stage, uploader: "문자열" }).uploader, undefined);
  assert.equal(parseStoreManifest({ ...stage, uploader: { handle: "h".repeat(200) } }).uploader?.handle?.length, 100);
});

test("다른 표정 라벨이 같은 키로 슬러그되면 두 번째는 설치 대상에서 뺀다", () => {
  // role 슬러그는 다르지만 표정 키는 같은 별칭으로 수렴 — 뒤 항목이 앞을 덮어쓰지 않게 한다.
  const character: StoreManifest = { ...stage, id: "ch1234567890ab", kind: "character", name: "이서린", files: [
    { role: "expression:슬픔", url: "https://losia.online/api/assets/ch1234567890ab/files/a" },
    { role: "expression:sad", url: "https://losia.online/api/assets/ch1234567890ab/files/b" },
  ] };
  const plan = installPlan(character);
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0]?.expression, "sad");
  assert.deepEqual(plan.ignored, ["expression:sad"]);
});

test("다운로드는 네트워크 오류·5xx 를 재시도하고 4xx·중단은 즉시 실패한다", async () => {
  const { downloadWithRetry } = await import("../src/studio/installFromStore.js");
  const source = (fail: (calls: number) => Error | null) => {
    let calls = 0;
    return {
      calls: () => calls,
      download: async () => {
        calls += 1;
        const error = fail(calls);
        if (error) throw error;
        return new Blob(["x"]);
      },
    };
  };

  const flaky = source(calls => calls < 3 ? new Error("Failed to fetch") : null);
  await downloadWithRetry(flaky, "id", "base");
  assert.equal(flaky.calls(), 3);

  const forbidden = source(() => Object.assign(new Error("embedded"), { status: 403 }));
  await assert.rejects(() => downloadWithRetry(forbidden, "id", "base"), /embedded/);
  assert.equal(forbidden.calls(), 1);

  const broken = source(() => Object.assign(new Error("HTTP 500"), { status: 500 }));
  await assert.rejects(() => downloadWithRetry(broken, "id", "base"));
  assert.equal(broken.calls(), 4);

  const controller = new AbortController();
  const halted = source(() => { controller.abort(); return new Error("Failed to fetch"); });
  await assert.rejects(() => downloadWithRetry(halted, "id", "base", controller.signal));
  assert.equal(halted.calls(), 1);
});
