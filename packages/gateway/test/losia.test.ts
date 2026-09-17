/**
 * losia.online 게시 프록시.
 *
 * 잡는 결함:
 * - 토큰을 프런트가 들고 있으면 새어나간다 → 게이트웨이 로컬 저장소에 두고 Bearer 는 여기서만 붙인다.
 * - 잘못된 형식/폐기된 토큰을 저장하면 게시가 매번 실패한다 → 등록 전에 형식+업스트림 검증.
 * - 업로드를 통째로 버퍼링하면 수백 MB 가 메모리에 두 번 오른다 → 스트림 중계 + 바이트 계수 상한.
 * - 토큰 없이 업로드 요청이 업스트림으로 새면 안 된다 → 선행 401.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { createMemoryLosiaTokenStore } from "../src/auth/losiaToken.js";
import { createMemoryProjectStore } from "../src/project/store.js";

const LOSIA = "https://losia.test";
const TOKEN = `la_${"a".repeat(40)}`;
const STUDIO = { "x-vnmaker-studio": "1" } as const;

interface Call { readonly url: string; readonly method: string; readonly auth: string | null; readonly contentType: string | null; body: string }

function fakeLosia(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const stream = init?.body;
    const call: Call = { url: raw, method: init?.method ?? "GET", auth: headers.get("authorization"), contentType: headers.get("content-type"), body: "" };
    calls.push(call);
    // undici 와 같이 본문 스트림 오류는 fetch 거부로 전파한다 — 호출 기록만 먼저 남긴다
    call.body = stream instanceof ReadableStream ? await new Response(stream).text() : typeof stream === "string" ? stream : "";
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function app(fetcher: typeof fetch, initialToken: string | null = null) {
  process.env.VNMAKER_LOSIA_URL = LOSIA;
  const tokens = createMemoryLosiaTokenStore(initialToken);
  const server = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore(), losiaFetch: fetcher, losiaTokens: tokens });
  return { server, tokens };
}

function multipart(): FormData {
  const form = new FormData();
  form.set("title", "비 오는 날");
  form.set("file", new Blob([new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4])], { type: "application/zip" }), "work.zip");
  return form;
}

test("status 는 토큰 보관 여부만 답한다 — 토큰 원문은 나가지 않는다", async () => {
  const { fetcher } = fakeLosia(() => new Response("{}", { status: 200 }));
  const empty = await app(fetcher).server.request("/api/losia/status");
  assert.deepEqual(await empty.json(), { configured: false, baseUrl: LOSIA });
  const ready = await app(fetcher, TOKEN).server.request("/api/losia/status");
  const body = await ready.json() as Record<string, unknown>;
  assert.equal(body["configured"], true);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
});

test("토큰 등록은 형식을 검증한다", async () => {
  const { fetcher, calls } = fakeLosia(() => new Response("{}", { status: 400 }));
  const { server, tokens } = app(fetcher);
  for (const bad of ["", "abc", `LA_${"a".repeat(40)}`, `la_${"a".repeat(39)}`, `la_${"g".repeat(40)}`]) {
    const res = await server.request("/api/losia/token", { method: "PUT", headers: { ...STUDIO, "content-type": "application/json" }, body: JSON.stringify({ token: bad }) });
    assert.equal(res.status, 400, bad);
  }
  assert.equal(calls.length, 0);
  assert.equal(tokens.peek(), null);
});

test("토큰 등록은 업스트림 검증 후에만 저장한다", async () => {
  // losia /api/works 는 인증(401)을 본문 형식(400)보다 먼저 본다 — 빈 POST 로 살아있는 토큰인지 확인
  const { fetcher, calls } = fakeLosia(call => new Response("{}", { status: call.auth === `Bearer ${TOKEN}` ? 400 : 401 }));
  const { server, tokens } = app(fetcher);
  const dead = await server.request("/api/losia/token", { method: "PUT", headers: { ...STUDIO, "content-type": "application/json" }, body: JSON.stringify({ token: `la_${"b".repeat(40)}` }) });
  assert.equal(dead.status, 401);
  assert.equal(tokens.peek(), null);
  const live = await server.request("/api/losia/token", { method: "PUT", headers: { ...STUDIO, "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
  assert.equal(live.status, 200);
  assert.equal(tokens.peek(), TOKEN);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, `${LOSIA}/api/works`);
  assert.equal(calls[0]!.method, "POST");
});

test("토큰 등록은 업스트림 장애를 502 로 돌리고 저장하지 않는다", async () => {
  const { fetcher } = fakeLosia(() => { throw new Error("ECONNREFUSED"); });
  const { server, tokens } = app(fetcher);
  const res = await server.request("/api/losia/token", { method: "PUT", headers: { ...STUDIO, "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
  assert.equal(res.status, 502);
  assert.equal(tokens.peek(), null);
});

test("토큰 삭제는 저장소를 비운다", async () => {
  const { fetcher } = fakeLosia(() => new Response("{}", { status: 200 }));
  const { server, tokens } = app(fetcher, TOKEN);
  const res = await server.request("/api/losia/token", { method: "DELETE", headers: STUDIO });
  assert.equal(res.status, 200);
  assert.equal(tokens.peek(), null);
});

test("작품 게시는 토큰이 없으면 업스트림을 부르지 않는다", async () => {
  const { fetcher, calls } = fakeLosia(() => new Response("{}", { status: 200 }));
  const res = await app(fetcher).server.request("/api/losia/works", { method: "POST", headers: STUDIO, body: multipart() });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("작품 게시는 multipart 만 받는다", async () => {
  const { fetcher, calls } = fakeLosia(() => new Response("{}", { status: 200 }));
  const res = await app(fetcher, TOKEN).server.request("/api/losia/works", { method: "POST", headers: { ...STUDIO, "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("작품 게시는 본문을 그대로 중계하고 Bearer 를 붙인다", async () => {
  const { fetcher, calls } = fakeLosia(() => Response.json({ ok: true, id: "w1", slug: "rainy-day", playUrl: "/play/rainy-day" }, { status: 201 }));
  const res = await app(fetcher, TOKEN).server.request("/api/losia/works", { method: "POST", headers: STUDIO, body: multipart() });
  assert.equal(res.status, 201);
  const body = await res.json() as { slug: string; playUrl: string };
  assert.equal(body.slug, "rainy-day");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, `${LOSIA}/api/works`);
  assert.equal(calls[0]!.auth, `Bearer ${TOKEN}`);
  assert.match(calls[0]!.contentType ?? "", /^multipart\/form-data; boundary=/);
  assert.match(calls[0]!.body, /비 오는 날/);
});

test("작품 게시는 업스트림의 오류를 그대로 돌려준다", async () => {
  const { fetcher } = fakeLosia(() => Response.json({ error: "slug가 이미 사용 중입니다" }, { status: 409 }));
  const res = await app(fetcher, TOKEN).server.request("/api/losia/works", { method: "POST", headers: STUDIO, body: multipart() });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "slug가 이미 사용 중입니다" });
});

test("작품 게시는 선언된 크기가 상한을 넘으면 끊는다", async () => {
  process.env.VNMAKER_LOSIA_WORK_MAX = "64";
  try {
    const { fetcher, calls } = fakeLosia(() => new Response("{}", { status: 200 }));
    const res = await app(fetcher, TOKEN).server.request("/api/losia/works", {
      method: "POST",
      // app.request 는 버퍼 본문에도 content-length 를 자동으로 붙이지 않아 명시한다
      headers: { ...STUDIO, "content-type": "multipart/form-data; boundary=x", "content-length": "1024" },
      body: new Uint8Array(128),
    });
    assert.equal(res.status, 413);
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.VNMAKER_LOSIA_WORK_MAX;
  }
});

test("작품 게시는 선언 없이 상한을 넘겨 흘려내도 끊는다", async () => {
  process.env.VNMAKER_LOSIA_WORK_MAX = "8";
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16));
        controller.enqueue(new Uint8Array(16));
        controller.close();
      },
    });
    const { fetcher, calls } = fakeLosia(() => new Response("{}", { status: 200 }));
    const boundary = "----vnmaker-test";
    const res = await app(fetcher, TOKEN).server.request("/api/losia/works", {
      method: "POST",
      headers: { ...STUDIO, "content-type": `multipart/form-data; boundary=${boundary}` },
      // @ts-expect-error RequestInit.duplex 는 아직 표준 타입에 없다
      body: stream, duplex: "half",
    });
    assert.equal(res.status, 413);
    assert.equal(calls.length, 1); // 스트림 중계 도중 상한 — 업스트림 요청은 시작됐다가 끊긴다
  } finally {
    delete process.env.VNMAKER_LOSIA_WORK_MAX;
  }
});

test("에셋 게시도 같은 프록시를 탄다", async () => {
  const { fetcher, calls } = fakeLosia(() => Response.json({ ok: true, id: "st12345678abcd" }, { status: 201 }));
  const form = new FormData();
  form.set("meta", JSON.stringify({ kind: "stage", name: "부엌 · 낮", license: "downloadable" }));
  form.set("roles", JSON.stringify(["base"]));
  form.set("files", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "base.png");
  const res = await app(fetcher, TOKEN).server.request("/api/losia/assets", { method: "POST", headers: STUDIO, body: form });
  assert.equal(res.status, 201);
  assert.equal(calls[0]!.url, `${LOSIA}/api/assets`);
  assert.equal(calls[0]!.auth, `Bearer ${TOKEN}`);
});

test("게시 라우트도 편집기 헤더 없는 POST 는 거부된다", async () => {
  const { fetcher, calls } = fakeLosia(() => new Response("{}", { status: 200 }));
  const res = await app(fetcher, TOKEN).server.request("/api/losia/works", { method: "POST", body: multipart() });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});
