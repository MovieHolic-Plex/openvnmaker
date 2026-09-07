import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { script, parseScript, type VnScript } from "@vnmaker/content";
import { readProjectBundle } from "../src/studio/restoreBundle.js";
import { mediaCredits } from "../src/studio/mediaCredits.js";
import { buildExportBundle, collectProjectAssets, rebaseProjectAssets } from "../src/studio/exportBundle.js";
import { createZip, crc32 } from "../src/studio/zip.js";

const encoder = new TextEncoder();
const fixture: VnScript = {
  title: "편집한 배포 <작품>", subtitle: "새 원고", start: "one", characters: script.characters.map(character => ({ ...character, expressionImages: { neutral: "/assets/art/actor.png", smile: "/api/image/file/smile.png" } })),
  assets: [{ id: "unused", name: "등록 미사용", kind: "background", url: "/assets/art/unused.png" }],
  scenes: [{ id: "one", background: "title", backgroundUrl: "/assets/art/start.png", sprites: [{ slot: "center", character: "seorin" }], bgm: "daily", lines: [
    { speaker: "seorin", text: "실제로 편집한 첫 대사", expression: "smile", sfx: "page-turn", cgUrl: "/api/image/file/cg.png" },
    { speaker: null, text: "두 번째", cgUrl: null, backgroundUrl: "/api/image/file/next.png", bgm: "rain", sprites: [{ slot: "center", character: "seorin", poseUrl: "/api/image/file/pose.webp" }] },
  ], ending: "현재 편집본의 결말" }],
};
const png = new Uint8Array(24); png.set([137, 80, 78, 71, 13, 10, 26, 10]);
const mp3 = encoder.encode("ID3audio-data");
const webp = encoder.encode("RIFF1234WEBP1234");
const runtimeJs = encoder.encode("document.body.textContent='standalone';");
const runtimeCss = encoder.encode("body{background:black}");
test("authored music fade validates and survives game ZIP restoration",async()=>{
  for(const musicFadeSeconds of [0,2.4,10]){
    const source={...fixture,musicFadeSeconds};const bundle=await buildExportBundle(source,{fetcher:fakeFetch()});
    assert.equal((await readProjectBundle(bundle.blob)).script.musicFadeSeconds,musicFadeSeconds);
  }
  for(const musicFadeSeconds of [-1,11,NaN,Infinity,"2",null])assert.throws(()=>parseScript({...fixture,musicFadeSeconds}),/음악 페이드/);
});
test("media records survive rebasing and ZIP restoration while unrecorded assets remain visible", async () => {
  const provenance = { creator: "Artist", source: "Receipt reference", license: "Author supplied terms", credit: "Artist credit\nSecond line" };
  const source = { ...fixture, assets: fixture.assets!.map(asset => ({ ...asset, provenance })) };
  const bundle = await buildExportBundle(source, { fetcher: fakeFetch() });
  const restored = await readProjectBundle(bundle.blob);
  assert.deepEqual(restored.script.assets![0]!.provenance, provenance);
  const report = mediaCredits(restored.script, collectProjectAssets(restored.script));
  assert.equal(report.files.find(file => file.path === restored.script.assets![0]!.url)!.status, "recorded");
  assert.equal(report.files.find(file => file.path.endsWith("ui-click.mp3"))!.status, "needs-record");
  assert.ok(report.text.includes(provenance.credit));
  const duplicate = {...source,assets:[...source.assets,{...source.assets[0]!,id:"unrecorded-copy",provenance:{}}]};
  assert.equal(mediaCredits(duplicate, [source.assets[0]!.url]).files[0]!.status,"needs-record");
  for (const invalid of [null, [], {creator:7}, {license:"x".repeat(4001)}, {credit:"\u0000"}, {unknown:"value"}]) {
    assert.throws(()=>parseScript({...source,assets:[{...source.assets[0],provenance:invalid}]}), /소재 출처/);
  }
  const audio = {...source,audioAssets:[{id:"sound",name:"Sound",kind:"sfx",url:`/assets/user/${"a".repeat(64)}.wav`,duration:1,provenance}]};
  assert.deepEqual(parseScript(audio).audioAssets![0]!.provenance,provenance);
});
test("hashed local webfonts and font notices travel with the export runtime", async () => {
  const font = encoder.encode("wOFF2local");
  const notice = encoder.encode("IBM Plex Sans KR\nNoto Serif KR\nSIL Open Font License, Version 1.1");
  const files = [...runtime.files,
    { path: "IBMPlexSansKR-Regular-test.woff2", size: font.length, sha256: createHash("sha256").update(font).digest("hex") },
    { path: "FONT-NOTICES.txt", size: notice.length, sha256: createHash("sha256").update(notice).digest("hex") },
  ];
  const manifest = { ...runtime, files };
  const bundle = await buildExportBundle(fixture, { fetcher: fakeFetch({
    "/export-runtime/manifest.json": Response.json(manifest),
    "/export-runtime/IBMPlexSansKR-Regular-test.woff2": new Response(font),
    "/export-runtime/FONT-NOTICES.txt": new Response(notice),
  }) });
  const zip = await unzip(bundle.blob);
  const text = (path: string) => new TextDecoder().decode(zip.get(path));
  assert.deepEqual(zip.get("IBMPlexSansKR-Regular-test.woff2"), font);
  assert.match(text("FONT-NOTICES.txt"), /SIL Open Font License, Version 1.1/);
  assert.ok(!text("index.html").includes("fonts.googleapis"));
});

test("runtime inventory is included byte-for-byte and protected by the export hash check", async () => {
  const bytes = encoder.encode('{"version":1,"components":[]}');
  const inventory = { path: "RUNTIME_COMPONENTS.json", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const manifest = { ...runtime, files: [...runtime.files, inventory] };
  const overrides = { "/export-runtime/manifest.json": Response.json(manifest), "/export-runtime/RUNTIME_COMPONENTS.json": new Response(bytes) };
  const bundle = await buildExportBundle(fixture, { fetcher: fakeFetch(overrides) });
  assert.deepEqual((await unzip(bundle.blob)).get(inventory.path), bytes);
  await assert.rejects(buildExportBundle(fixture, { fetcher: fakeFetch({ ...overrides, "/export-runtime/RUNTIME_COMPONENTS.json": new Response("modified") }) }), /플레이어 파일이 변경/);
});
const runtime = { version: 1, entry: "player-test.js", stylesheets: ["style-test.css"], files: [{ path: "player-test.js", size: runtimeJs.length, sha256: createHash("sha256").update(runtimeJs).digest("hex") }, { path: "style-test.css", size: runtimeCss.length, sha256: createHash("sha256").update(runtimeCss).digest("hex") }] };
function fakeFetch(overrides: Record<string, Response> = {}, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = String(input); calls.push(path);
    if (overrides[path]) return overrides[path]!.clone();
    if (path.endsWith("manifest.json")) return Response.json(runtime);
    if (path.endsWith("player-test.js")) return new Response(runtimeJs);
    if (path.endsWith("style-test.css")) return new Response(runtimeCss);
    return new Response(path.endsWith(".mp3") ? mp3 : path.endsWith(".webp") ? webp : png);
  }) as typeof fetch;
}
async function unzip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer()); const view = new DataView(bytes.buffer);
  const files = new Map<string, Uint8Array>(); let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true); const length = view.getUint16(offset + 26, true); const extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length)); const start = offset + 30 + length + extra;
    const body = bytes.slice(start, start + size); assert.equal(crc32(body), view.getUint32(offset + 14, true)); files.set(name, body); offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), files.size);
  return files;
}

test("all scene/line cues, conditional poses, expression overrides and registered art are collected once", () => {
  const paths = collectProjectAssets(fixture);
  for (const path of ["/assets/art/start.png", "/assets/art/unused.png", "/api/image/file/smile.png", "/api/image/file/cg.png", "/api/image/file/next.png", "/api/image/file/pose.webp", "/assets/audio/bgm/rain.mp3", "/assets/audio/bgm/daily.mp3", "/assets/audio/sfx/page-turn.mp3", "/assets/audio/sfx/ui-click.mp3"]) assert.ok(paths.includes(path), path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(!paths.includes("/assets/bg/title.png"));
});

test("ZIP contains edited manuscript, rewritten generated art, isolated namespace and no source mutation", async () => {
  const before = JSON.stringify(fixture); const calls: string[] = [];
  const result = await buildExportBundle(fixture, { fetcher: fakeFetch({}, calls) }); const files = await unzip(result.blob);
  const text = (path: string) => new TextDecoder().decode(files.get(path));
  const project = JSON.parse(text("project.json")) as VnScript;
  assert.equal(project.title, fixture.title); assert.equal(project.scenes[0]?.lines[0]?.text, "실제로 편집한 첫 대사");
  assert.ok(!text("project.json").includes("/api/image/file/"));
  assert.ok(project.scenes[0]?.lines[1]?.sprites?.[0]?.poseUrl?.startsWith("/assets/exported/"));
  assert.equal(project.scenes[0]?.lines[1]?.cgUrl, null);
  for (const path of collectProjectAssets(project)) assert.ok(files.has(path.slice(1)), `missing ${path}`);
  assert.match(text("index.html"), /편집한 배포 &lt;작품&gt;/); assert.ok(!text("index.html").includes("fonts.googleapis"));
  assert.match(result.projectNamespace, /^bundle-[a-f0-9]{16}$/); assert.ok(text("bundle.json").includes(result.projectNamespace));
  assert.equal(JSON.stringify(fixture), before); assert.equal(calls.filter(path => path === "/api/image/file/smile.png").length, 1);
  const again = await buildExportBundle(fixture, { fetcher: fakeFetch() }); assert.equal(again.projectNamespace, result.projectNamespace);
  const changed = await buildExportBundle({ ...fixture, title: "수정한 작품" }, { fetcher: fakeFetch() }); assert.notEqual(changed.projectNamespace, result.projectNamespace);
});

test("missing and SPA HTML fallback media fail together instead of exporting a broken game", async () => {
  await assert.rejects(buildExportBundle(fixture, { fetcher: fakeFetch({ "/assets/art/start.png": new Response("missing", { status: 404 }), "/api/image/file/cg.png": new Response("<!DOCTYPE html><html>Vite fallback</html>") }) }), error => {
    const message = (error as Error).message;
    return message.includes("파일 2개") && message.includes("/assets/art/start.png — HTTP 404") && message.includes("/api/image/file/cg.png");
  });
});

test("aborting a pending asset fetch produces no downloadable partial ZIP", async () => {
  const controller = new AbortController(); const base = fakeFetch();
  const fetcher: typeof fetch = async (input, init) => { if (String(input).startsWith("/assets/")) controller.abort(); return base(input, init); };
  await assert.rejects(buildExportBundle(fixture, { fetcher, signal: controller.signal }), { name: "AbortError" });
});

test("runtime integrity and unsafe paths are checked before download", async () => {
  await assert.rejects(buildExportBundle(fixture, { fetcher: fakeFetch({ "/export-runtime/player-test.js": new Response("changed") }) }), /플레이어 파일이 변경/);
  await assert.rejects(buildExportBundle(fixture, { fetcher: fakeFetch({ "/export-runtime/manifest.json": Response.json({ ...runtime, entry: "../private.js" }) }) }), /플레이어 정보/);
  assert.throws(() => createZip([{ path: "../escape", bytes: png }]), /경로/);
  assert.throws(() => createZip([{ path: "same", bytes: png }, { path: "same", bytes: png }]), /경로/);
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
});

test("rebasing preserves branch conditions and explicit scene/actor/music reset cues", () => {
  const first = fixture.scenes[0]!;
  const source = { ...fixture, scenes: [{ ...first, lines: [{ speaker: null, text: "조건부", when: { all: ["remember"] }, bgm: null, cgUrl: null, sprites: [{ slot: "center", character: "seorin", poseUrl: null }] }] }] } satisfies VnScript;
  const changed = rebaseProjectAssets(source, new Map([["/assets/art/start.png", "/assets/exported/start.png"]]));
  assert.equal(changed.scenes[0]?.backgroundUrl, "/assets/exported/start.png"); assert.deepEqual(changed.scenes[0]?.lines[0], source.scenes[0]!.lines[0]);
});

test("team credits validate bounded text and retain ordered multiline records through parsing", () => {
  const credits=[{role:"시나리오",names:"한나\n도윤"},{role:"",names:"참여자"},{role:"빈 초안",names:""}];
  const parsed=parseScript({...fixture,credits});assert.deepEqual(parsed.credits,credits);
  for(const credits of [null,{},[{}],[{role:1,names:"A"}],[{role:"R",names:"a".repeat(4001)}],[{role:"R".repeat(121),names:"A"}],[{role:"R",names:"A\u0000"}],[{role:"R",names:"A",extra:1}],Array.from({length:101},()=>({role:"R",names:"A"}))])assert.throws(()=>parseScript({...fixture,credits}));
});
