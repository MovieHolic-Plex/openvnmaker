/**
 * 적대적 리뷰(2026-09-14) 편집기 데이터 계층 회귀.
 *
 * 잡는 결함:
 * - 빠른 복구 사본 쓰기가 용량 초과로 실패한 뒤 보관함만 갱신되면, 다음 실행이 오래된 사본을 열고 보관함을 덮어썼다.
 * - activateProject 가 사본을 먼저 쓰고 id 를 나중에 써서, 용량 초과 롤백 실패 시 다른 작품 id 아래에 새 원고가 남았다.
 * - 상한 초과(대사 20,000자 등)로 읽지 못한 원고는 샘플로 대체되고 되살릴 길이 없었다.
 * - ZIP 복원이 내장 배경·스프라이트를 전부 사용자 복사본으로 바꾸고 없던 backgroundUrl 을 채워 원고를 91필드나 바꿨다.
 * - Ren'Py 문자열을 JSON 규칙으로 이스케이프해 탭·CR 이 글자 t·r 로 찍혔다. 잠긴 선택지가 클릭 가능한 항목으로 나왔다.
 * - 같은 PNG 를 두 번 가져오면 카드가 둘 생겼다. 스토어 설치가 파일을 저장한 뒤에야 캐릭터 미선택으로 실패해 고아 blob 을 남겼다.
 * - 보관함 원본 JSON 은 내보낼 수만 있고 들여올 수 없었다.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { script as sample, parseScript, type VnScript } from "@vnmaker/content";
import { PROJECT_KEY, PROJECT_META_KEY, clearQuickRecovery, loadProject, quickRecoveryHash, readQuickRecoveryMeta, salvageScript, writeQuickRecovery } from "../src/studio/project.js";
import { ACTIVE_PROJECT_KEY, activateProject, stripSharedNativeSaveId } from "../src/studio/projects.js";
import { bundlePathKind, readProjectBundle, rebaseRestoredScript } from "../src/studio/restoreBundle.js";
import { buildExportBundle, collectProjectAssets } from "../src/studio/exportBundle.js";
import { generateRenpyScript, renpyText } from "../src/studio/renpyScript.js";
import { RENPY_PLAYER_THEME } from "../src/studio/renpyTheme.js";
import { dedupeImportedArtwork, unregisterArtwork } from "../src/studio/assets.js";
import { isLibraryArchive, parseLibraryArchive, serializeLibraryArchive } from "../src/studio/libraryArchive.js";
import { assertInstallable, installPlan, StoreInstallError, type StoreManifest } from "../src/studio/storeInstall.js";
import { unreferencedUserAssets } from "../src/studio/assetCleanup.js";

/** 총 글자 수 한도를 흉내 내는 localStorage. 브라우저처럼 setItem 만 QuotaExceededError 를 던진다. */
function fakeStorage(quota = Infinity): Storage {
  const map = new Map<string, string>();
  const size = (except?: string) => [...map].reduce((sum, [key, value]) => key === except ? sum : sum + key.length + value.length, 0);
  return {
    get length() { return map.size; }, clear: () => map.clear(), key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null, removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { if (size(key) + key.length + value.length > quota) throw new DOMException("quota", "QuotaExceededError"); map.set(key, value); },
  } as unknown as Storage;
}
const tiny: VnScript = { title: "회귀", subtitle: "", start: "a", characters: [{ id: "hero", name: "주인공", color: "#aabbcc", bio: "" }], scenes: [{ id: "a", chapter: "A", background: "title", lines: [{ speaker: "hero", text: "첫 문장." }], next: "b" }, { id: "b", chapter: "B", background: "campus-gate", lines: [{ speaker: null, text: "끝." }], ending: "끝" }] };
const longer = { ...tiny, scenes: tiny.scenes.map(scene => ({ ...scene, lines: [...scene.lines, { speaker: null, text: "더 긴 두 번째 판본 문장입니다. ".repeat(20) }] })) };

test("quick-recovery meta pairs with the exact stored text and reports unknown age otherwise", () => {
  const storage = fakeStorage();
  writeQuickRecovery(tiny, storage, 1000);
  const raw = storage.getItem(PROJECT_KEY)!;
  assert.deepEqual(readQuickRecoveryMeta(raw, storage), { updatedAt: 1000, hash: quickRecoveryHash(raw) });
  // 사본만 바뀌고 메타가 그대로면(쓰기 도중 실패) 짝이 어긋난다 → 나이를 모른다.
  storage.setItem(PROJECT_KEY, JSON.stringify(longer));
  assert.equal(readQuickRecoveryMeta(storage.getItem(PROJECT_KEY)!, storage), null);
  // 레거시(메타 없음)도 null — 예전 규칙(사본이 이긴다)을 유지한다.
  storage.removeItem(PROJECT_META_KEY);
  assert.equal(readQuickRecoveryMeta(raw, storage), null);
  clearQuickRecovery(storage);
  assert.equal(storage.getItem(PROJECT_KEY), null); assert.equal(storage.getItem(PROJECT_META_KEY), null);
});

test("meta write failure removes the meta instead of leaving a wrong age", () => {
  const json = JSON.stringify(tiny);
  const storage = fakeStorage(PROJECT_KEY.length + json.length + 10);
  writeQuickRecovery(tiny, storage, 5);
  assert.equal(storage.getItem(PROJECT_KEY), json);
  assert.equal(storage.getItem(PROJECT_META_KEY), null);
});

test("activateProject writes the active id first and clears a copy it cannot store — never a foreign manuscript under a new id", () => {
  const previous = JSON.stringify(tiny);
  const storage = fakeStorage(ACTIVE_PROJECT_KEY.length + 36 + PROJECT_KEY.length + previous.length + PROJECT_META_KEY.length + 80);
  storage.setItem(ACTIVE_PROJECT_KEY, "original-project"); writeQuickRecovery(tiny, storage);
  const result = activateProject("11111111-2222-3333-4444-555555555555", longer, storage);
  assert.equal(result.quickRecovery, false);
  assert.equal(storage.getItem(ACTIVE_PROJECT_KEY), "11111111-2222-3333-4444-555555555555");
  // 이전 코드는 여기서 예외를 던지고, 롤백 실패 시 새 원고를 옛 id 아래에 남길 수 있었다. 지금은 사본을 비워 보관함에서 열게 한다.
  assert.equal(storage.getItem(PROJECT_KEY), null); assert.equal(storage.getItem(PROJECT_META_KEY), null);
  const roomy = fakeStorage(); roomy.setItem(ACTIVE_PROJECT_KEY, "original-project");
  assert.equal(activateProject("new-id", longer, roomy).quickRecovery, true);
  assert.equal(JSON.parse(roomy.getItem(PROJECT_KEY)!).scenes[0].lines.length, 2);
});

test("loadProject names the parse failure and salvage clips over-limit text instead of falling back to the sample", () => {
  const storage = fakeStorage();
  const huge = { ...tiny, scenes: tiny.scenes.map((scene, index) => index ? scene : { ...scene, lines: [{ speaker: "hero", text: "가".repeat(20_001) }, { speaker: null, text: "살아남는 둘째 문장" }] }) };
  storage.setItem(PROJECT_KEY, JSON.stringify(huge));
  const loaded = loadProject(storage);
  assert.equal(loaded.script.title, sample.title);
  assert.match(loaded.error ?? "", /대사: 올바른 텍스트/);
  const salvaged = salvageScript(huge)!;
  assert.equal(salvaged.script.scenes[0]!.lines[0]!.text.length, 20_000);
  assert.equal(salvaged.script.scenes[0]!.lines[1]!.text, "살아남는 둘째 문장");
  assert.equal(salvaged.changes.length, 1);
  const manyScenes = { ...tiny, scenes: [...Array.from({ length: 300 }, (_, index) => ({ id: `s${index}`, background: "title", lines: [{ speaker: null, text: "x" }], next: `s${index + 1}` })), { id: "s300", background: "title", lines: [{ speaker: null, text: "y" }], ending: "끝" }], start: "s0" };
  assert.throws(() => parseScript(manyScenes), /1~300/);
  assert.equal(salvageScript(manyScenes)!.script.scenes.length, 300);
  // 상한 초과가 아닌 손상은 되살리지 못한다 — 거짓 복구를 하지 않는다.
  assert.equal(salvageScript({ ...tiny, start: "missing" }), null);
  assert.equal(salvageScript("garbage"), null);
});

const png = new Uint8Array(24); png.set([137, 80, 78, 71, 13, 10, 26, 10]); png[20] = 7;
const otherPng = new Uint8Array(24); otherPng.set([137, 80, 78, 71, 13, 10, 26, 10]); otherPng[20] = 9;
const mp3 = new TextEncoder().encode("ID3audio-data");
const runtimeJs = new TextEncoder().encode("document.body.textContent='standalone';");
const runtime = { version: 1, entry: "player-test.js", stylesheets: [], files: [{ path: "player-test.js", size: runtimeJs.length, sha256: createHash("sha256").update(runtimeJs).digest("hex") }] };
const fakeFetch = (files: Record<string, Uint8Array> = {}): typeof fetch => (async (input: string | URL | Request) => {
  const path = String(input);
  if (path.endsWith("manifest.json")) return Response.json(runtime);
  if (path.endsWith("player-test.js")) return new Response(runtimeJs);
  if (files[path]) return new Response(files[path]);
  return new Response(path.endsWith(".mp3") ? mp3 : png);
}) as typeof fetch;
const userSha = createHash("sha256").update(otherPng).digest("hex");
const fidelity: VnScript = { ...tiny, nativeSaveId: "0123456789abcdef", characters: [{ id: "seorin", name: "서린", color: "#aabbcc", bio: "" }, { id: "hero", name: "주인공", color: "#aabbcc", bio: "" }], scenes: [{ ...tiny.scenes[0]!, sprites: [{ slot: "center", character: "seorin" }] }, { ...tiny.scenes[1]!, backgroundUrl: `/assets/user/${userSha}.png` }] };

test("bundle restore keeps built-in references implicit and only rewrites moved files", async () => {
  const bundle = await buildExportBundle(fidelity, { fetcher: fakeFetch({ [`/assets/user/${userSha}.png`]: otherPng }) });
  const { script } = await readProjectBundle(bundle.blob);
  assert.deepEqual(rebaseRestoredScript(script, new Map()), fidelity, "아무 파일도 옮기지 않았으면 원고는 그대로다");
  assert.equal(bundlePathKind("/assets/user/x.png"), "user"); assert.equal(bundlePathKind("/assets/exported/x.png"), "exported"); assert.equal(bundlePathKind("/assets/bg/title.png"), "builtin");
  // 기본 배경 title 만 다른 판본이라 옮겨질 때: 그 배경을 암묵적으로 쓰던 씬만 명시 주소를 얻고, 배우는 건드리지 않는다.
  const moved = rebaseRestoredScript(script, new Map([["/assets/bg/title.png", "/assets/user/aa.png"]]));
  assert.equal(moved.scenes[0]!.backgroundUrl, "/assets/user/aa.png");
  assert.equal(moved.scenes[1]!.backgroundUrl, `/assets/user/${userSha}.png`);
  assert.equal(moved.characters[0]!.expressionImages, undefined);
  // 내장 배우 스프라이트 하나만 옮겨질 때: 그 표정 하나만 명시한다.
  const sprite = rebaseRestoredScript(script, new Map([["/assets/sprite/seorin-smile.png", "/assets/user/bb.png"]]));
  assert.deepEqual(sprite.characters[0]!.expressionImages, { smile: "/assets/user/bb.png" });
  assert.equal(sprite.scenes[0]!.backgroundUrl, undefined);
  assert.equal(collectProjectAssets(sprite).includes("/assets/user/bb.png"), true);
});

test("restoring next to a project with the same native save id strips it; otherwise the id survives", () => {
  assert.equal(stripSharedNativeSaveId(fidelity, [tiny]).stripped, false);
  const result = stripSharedNativeSaveId(fidelity, [{ ...tiny, nativeSaveId: "0123456789abcdef" }]);
  assert.equal(result.stripped, true); assert.equal(result.script.nativeSaveId, undefined); assert.equal(result.script.title, fidelity.title);
});

test("exported index.html explains file:// before the module script and still references no external host", async () => {
  const bundle = await buildExportBundle(tiny, { fetcher: fakeFetch() });
  const bytes = new Uint8Array(await bundle.blob.arrayBuffer());
  const html = new TextDecoder().decode(bytes).match(/<!doctype html>[\s\S]*?<\/html>/)![0];
  assert.ok(html.indexOf('location.protocol==="file:"') < html.indexOf('type="module"'));
  assert.match(html, /README\.txt/);
  assert.ok(!/https:\/\/|fonts\.googleapis/.test(html), "배포 index.html 은 외부 주소를 참조하지 않는다(오프라인·외부 요청 없음 계약)");
});

test("Ren'Py literals only use escapes the Ren'Py lexer understands", () => {
  assert.equal(renpyText("탭\t캐리지\r줄바꿈\n끝"), '"탭 캐리지\\n줄바꿈\\n끝"');
  assert.equal(renpyText('그 "말" \\ [x] {b} 100%'), '"그 \\"말\\" \\\\ [[x] {{b} 100%"');
  assert.equal(renpyText("제어문자"), '"제어문자"');
  const generated = generateRenpyScript({ ...tiny, scenes: [{ ...tiny.scenes[0]!, lines: [{ speaker: "hero", text: "탭\t안의\t대사" }], choices: [{ text: "열린 길", next: "b" }, { text: "잠긴 길", next: "b", disable: true }] }, tiny.scenes[1]!] });
  assert.match(generated, /vn_actor_0 "탭 안의 대사"/);
  // JSON 페이로드(Python 이 읽음)는 그대로, say 문장(Ren'Py 렉서가 읽음)만 검사한다.
  for (const line of generated.split("\n").filter(line => /^\s+(vn_actor_\d+ |vn_legacy_me )?"/.test(line))) assert.doesNotMatch(line, /\\[tr]/);
  assert.match(generated, /"잠긴 길" \(vn_locked=True\):\n            pass/);
  assert.match(RENPY_PLAYER_THEME, /item\.kwargs\.get\("vn_locked", False\)/);
});

test("re-importing the same image does not create a second card; removing a card keeps the story intact", () => {
  const registered = parseScript({ ...tiny, assets: [{ id: "user-1", name: "a", kind: "background", url: "/assets/user/aa.png" }, { id: "user-2", name: "a", kind: "cg", url: "/assets/user/aa.png" }] });
  const rows = [{ path: "/assets/user/aa.png", originalName: "a.png", createdAt: 1 }, { path: "/assets/user/aa.png", originalName: "a-copy.png", createdAt: 2 }, { path: "/assets/user/bb.png", originalName: "b.png", createdAt: 3 }];
  const result = dedupeImportedArtwork(registered, rows, "background");
  assert.deepEqual(result.fresh.map(row => row.path), ["/assets/user/bb.png"]); assert.equal(result.skipped, 2);
  // 다른 용도(캐릭터 표정)로는 같은 파일을 새로 등록할 수 있다.
  assert.equal(dedupeImportedArtwork(registered, rows.slice(0, 1), "character", "hero", "smile").fresh.length, 1);
  const removed = unregisterArtwork(registered, "user-2");
  assert.deepEqual(removed.assets!.map(asset => asset.id), ["user-1"]); assert.deepEqual(removed.scenes, registered.scenes);
  assert.deepEqual(unreferencedUserAssets(["/assets/user/aa.png", "/assets/user/zz.png", "/assets/bg/title.png"], [{ ...tiny, scenes: [{ ...tiny.scenes[0]!, backgroundUrl: "/assets/user/aa.png" }, tiny.scenes[1]!] }]), ["/assets/user/zz.png"]);
});

test("library archive JSON round-trips and is distinguished from a plain manuscript", () => {
  const records = [{ id: "p1", script: tiny, updatedAt: 5 }, { id: "broken", script: null, updatedAt: 1 }];
  const text = serializeLibraryArchive(records);
  assert.equal(isLibraryArchive(JSON.parse(text)), true); assert.equal(isLibraryArchive(tiny), false);
  assert.deepEqual(parseLibraryArchive(text).records, records);
  assert.throws(() => parseLibraryArchive(JSON.stringify(tiny)), /형식이 아닙니다/);
  assert.throws(() => parseLibraryArchive(JSON.stringify({ format: "vnmaker-library-archive", version: 2, records: [] })), /버전/);
});

test("store install refuses before downloading when a character asset has no target character", () => {
  const manifest: StoreManifest = { spec: "losia-asset/1", id: "ch1", kind: "character", name: "인물", license: "downloadable", files: [{ role: "base", url: "https://losia.online/api/assets/ch1/files/base" }] };
  const plan = installPlan(manifest);
  assert.throws(() => assertInstallable(plan, {}), (error: unknown) => error instanceof StoreInstallError && /캐릭터/.test(error.message));
  assert.doesNotThrow(() => assertInstallable(plan, { characterId: "hero" }));
  assert.doesNotThrow(() => assertInstallable(installPlan({ ...manifest, kind: "stage" }), {}));
});

test("the unload flush only refreshes a copy this session wrote — external edits and cleared copies are left alone", async () => {
  const { ownsQuickRecovery } = await import("../src/studio/project.js");
  const storage = fakeStorage();
  const hash = writeQuickRecovery(tiny, storage);
  assert.equal(ownsQuickRecovery(hash, storage), true);
  assert.equal(ownsQuickRecovery(null, storage), false, "아직 쓰지 않았으면 갱신하지 않는다");
  storage.setItem(PROJECT_KEY, JSON.stringify(longer));
  assert.equal(ownsQuickRecovery(hash, storage), false, "다른 곳이 바꾼 사본은 덮어쓰지 않는다");
  clearQuickRecovery(storage);
  assert.equal(ownsQuickRecovery(hash, storage), false, "비운 사본은 되살리지 않는다");
});
