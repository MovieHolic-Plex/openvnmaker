import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect } from "node:net";
import { parseRange, resolveWithinRoot, startDesktopServer, type DesktopServer, type HonoLike } from "../src/server.js";

/** 게이트웨이 계약은 fetch 하나뿐이라 테스트에 실제 서버 프레임워크가 필요 없다. */
function fakeGateway(handler: (request: Request) => Response | Promise<Response>): HonoLike {
  return { fetch: handler };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

/** fetch 는 Host 헤더를 못 바꾸고 URL 을 정규화한다. 브라우저가 아닌 공격자를 흉내내려면 생 소켓이 필요하다. */
function raw(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(request));
    let data = "";
    socket.setTimeout(5_000, () => { socket.destroy(); reject(new Error("timeout")); });
    socket.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
    socket.on("close", () => resolve(data));
    socket.on("error", reject);
  });
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-desktop-"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>player</title>");
  await writeFile(join(root, "studio.html"), "<!doctype html><title>studio</title>");
  await writeFile(join(root, "project-assets-sw.js"), "self.addEventListener('fetch',()=>{});");
  await mkdir(join(root, "assets", "audio"), { recursive: true });
  await writeFile(join(root, "assets", "audio", "bgm.mp3"), Buffer.from("0123456789"));
  return root;
}

async function serve(extra: Partial<Parameters<typeof startDesktopServer>[0]> = {}): Promise<{ server: DesktopServer; root: string }> {
  const root = await fixture();
  const server = await startDesktopServer({ webRoot: root, port: 0, ...extra });
  return { server, root };
}

test("resolveWithinRoot 는 루트 밖 경로와 널바이트를 막는다", () => {
  // 경로 구분자와 드라이브 문자가 OS 마다 다르다. 기대값도 같은 API 로 만들어야 윈도우에서 깨지지 않는다.
  const root = resolve("/srv/web");
  assert.equal(resolveWithinRoot(root, "/"), join(root, "index.html"));
  assert.equal(resolveWithinRoot(root, "/assets/a.png"), join(root, "assets", "a.png"));
  assert.equal(resolveWithinRoot(root, "/../../etc/passwd"), null);
  assert.equal(resolveWithinRoot(root, "/a\0b"), null);
});

test("parseRange 는 열린 범위와 접미 범위를 파일 크기에 맞춘다", () => {
  assert.deepEqual(parseRange("bytes=0-3", 10), { start: 0, end: 3 });
  assert.deepEqual(parseRange("bytes=5-", 10), { start: 5, end: 9 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=2-100", 10), { start: 2, end: 9 });
  assert.equal(parseRange("bytes=20-30", 10), null, "파일 밖 범위는 416");
  assert.equal(parseRange(undefined, 10), null);
});

test("정적 파일: / 는 플레이어, /studio.html 은 스튜디오, 서비스 워커는 자바스크립트로 나간다", async () => {
  const { server } = await serve();
  try {
    const player = await fetch(`${server.url}/`);
    assert.equal(player.status, 200);
    assert.match(player.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await player.text(), /player/);

    const studio = await fetch(`${server.url}/studio.html`);
    assert.match(await studio.text(), /studio/);

    // 서비스 워커가 자바스크립트 MIME 이 아니면 등록이 거부되고 사용자 파일 보관함이 통째로 죽는다.
    const worker = await fetch(`${server.url}/project-assets-sw.js`);
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get("content-type") ?? "", /javascript/);
  } finally { await server.close(); }
});

test("경로 조작은 403, 없는 파일은 404, 쓰기 메서드는 405", async () => {
  const { server } = await serve();
  try {
    // 평범한 ../ 는 URL 파서가 먼저 정규화해 루트 밖으로 못 나간다.
    assert.equal((await fetch(`${server.url}/../../etc/passwd`)).status, 404);
    // 인코딩된 슬래시(%2f)는 URL 정규화를 통과한다 — 경로를 풀고 나서 루트 밖이면 막아야 한다.
    assert.equal((await fetch(`${server.url}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)).status, 403);
    assert.equal((await fetch(`${server.url}/%00`)).status, 403);
    assert.equal((await fetch(`${server.url}/없는파일.html`)).status, 404);
    assert.equal((await fetch(`${server.url}/studio.html`, { method: "POST" })).status, 405);
  } finally { await server.close(); }
});

test("Range 요청은 206 으로 부분만 준다(오디오 탐색)", async () => {
  const { server } = await serve();
  try {
    const res = await fetch(`${server.url}/assets/audio/bgm.mp3`, { headers: { Range: "bytes=2-5" } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await res.text(), "2345");
    const bad = await fetch(`${server.url}/assets/audio/bgm.mp3`, { headers: { Range: "bytes=50-60" } });
    assert.equal(bad.status, 416);
  } finally { await server.close(); }
});

test("다른 호스트 이름으로 온 요청은 막는다(DNS 리바인딩)", async () => {
  const { server } = await serve();
  try {
    const evil = await raw(server.port, "GET / HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n");
    assert.match(evil, /^HTTP\/1\.1 403/, evil.slice(0, 80));
    const ok = await raw(server.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`);
    assert.match(ok, /^HTTP\/1\.1 200/, ok.slice(0, 80));
  } finally { await server.close(); }
});

test("/api/* 는 게이트웨이로, 그 밖은 정적 파일로 간다", async () => {
  const gateway = fakeGateway(() => json({ ok: true }));
  const { server } = await serve({ gateway });
  try {
    const health = await fetch(`${server.url}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    // 같은 서버가 계속 정적 파일도 준다 — 한 오리진이어야 서비스 워커와 /assets 가 성립한다.
    assert.equal((await fetch(`${server.url}/studio.html`)).status, 200);
  } finally { await server.close(); }
});

test("게이트웨이 본문 상한을 넘기면 413 이고 업스트림을 부르지 않는다", async () => {
  let called = false;
  const gateway = fakeGateway(() => { called = true; return json({ ok: true }); });
  const { server } = await serve({ gateway, bodyMax: 64 });
  try {
    const res = await fetch(`${server.url}/api/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(4096) });
    assert.equal(res.status, 413);
    assert.equal(called, false);
  } finally { await server.close(); }
});

test("POST 본문과 헤더가 게이트웨이까지 그대로 전달된다", async () => {
  const gateway = fakeGateway(async (request) => json({ body: await request.json(), studio: request.headers.get("x-vnmaker-studio") }));
  const { server } = await serve({ gateway });
  try {
    const res = await fetch(`${server.url}/api/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
      body: JSON.stringify({ hello: "원고" }),
    });
    assert.deepEqual(await res.json(), { body: { hello: "원고" }, studio: "1" });
  } finally { await server.close(); }
});

test("/api/native-build 는 게이트웨이보다 먼저 전용 미들웨어가 받는다", async () => {
  let seen = "";
  const gateway = fakeGateway(() => json({ from: "gateway" }));
  const { server } = await serve({
    gateway,
    nativeBuild: (req, res) => { seen = req.url ?? ""; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ from: "native" })); },
  });
  try {
    const res = await fetch(`${server.url}/api/native-build/status`);
    assert.deepEqual(await res.json(), { from: "native" });
    assert.equal(seen, "/api/native-build/status");
    // 나머지 /api 는 계속 게이트웨이 몫이다.
    assert.deepEqual(await (await fetch(`${server.url}/api/health`)).json(), { from: "gateway" });
  } finally { await server.close(); }
});

test("게이트웨이 없이도 정적 서버로 뜨고 /api 는 503 을 준다", async () => {
  const { server } = await serve();
  try {
    assert.equal((await fetch(`${server.url}/api/health`)).status, 503);
  } finally { await server.close(); }
});

test("close() 는 연결이 남아 있어도 끝난다", async () => {
  const { server, root } = await serve();
  await fetch(`${server.url}/`);
  await server.close();
  await rm(root, { recursive: true, force: true });
  await assert.rejects(fetch(`${server.url}/`));
});
