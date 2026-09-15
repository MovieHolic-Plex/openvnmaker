/**
 * losia.online 에셋 스토어 프록시.
 *
 * 잡는 결함:
 * - 브라우저가 losia 를 직접 부르면 CORS 에 막힌다 → 게이트웨이가 서버사이드로 대신 부른다.
 * - 쿼리 파라미터를 그대로 흘리면 임의 파라미터/과도한 take 가 업스트림으로 간다 → 허용 목록 + 상한.
 * - `embedded` 등급은 원본을 배포하지 않는다 — 클라이언트가 우회하지 못하게 프록시가 거부한다.
 * - 자산 id 가 경로가 되어 업스트림 URL 을 조립하면 안 된다 → 형식 검증.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { createMemoryProjectStore } from "../src/project/store.js";

const LOSIA = "https://losia.test";

interface Call { readonly url: string; readonly method: string }

/** 업스트림을 대신하는 가짜 fetch. 응답을 경로별로 정한다. */
function fakeLosia(routes: Record<string, (url: URL) => Response | undefined>, calls: Call[] = []) {
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    calls.push({ url: raw, method: init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET") });
    const handler = routes[url.pathname];
    const response = handler?.(url);
    return response ?? new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function app(fetcher: typeof fetch) {
  process.env.VNMAKER_LOSIA_URL = LOSIA;
  return createApp({ store: createMemoryStore(null), project: createMemoryProjectStore(), losiaFetch: fetcher });
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/* ── 카탈로그 ─────────────────────────────────────────── */

test("카탈로그는 허용된 파라미터만 업스트림으로 넘긴다", async () => {
  const { fetcher, calls } = fakeLosia({
    "/api/assets": () => Response.json({ items: [{ id: "stb33826d1890f", kind: "stage", name: "부엌 · 낮", license: "downloadable" }], total: 327 }),
  });
  const res = await app(fetcher).request("/api/store/catalog?kind=stage&q=%EB%B6%80%EC%97%8C&sort=new&take=12&skip=24&evil=1");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number };
  assert.equal(body.total, 327);
  assert.equal(calls.length, 1);
  const upstream = new URL(calls[0]!.url);
  assert.equal(upstream.origin, LOSIA);
  assert.equal(upstream.pathname, "/api/assets");
  assert.equal(upstream.searchParams.get("kind"), "stage");
  assert.equal(upstream.searchParams.get("q"), "부엌");
  assert.equal(upstream.searchParams.get("sort"), "new");
  assert.equal(upstream.searchParams.get("take"), "12");
  assert.equal(upstream.searchParams.get("skip"), "24");
  assert.equal(upstream.searchParams.get("evil"), null);
});

test("take 는 상한으로 잘리고 음수 skip 은 0 이 되며 잘못된 kind 는 거부한다", async () => {
  const { fetcher, calls } = fakeLosia({ "/api/assets": () => Response.json({ items: [], total: 0 }) });
  const gateway = app(fetcher);
  const res = await gateway.request("/api/store/catalog?take=100000&skip=-5");
  assert.equal(res.status, 200);
  assert.equal(new URL(calls[0]!.url).searchParams.get("take"), "60");
  assert.equal(new URL(calls[0]!.url).searchParams.get("skip"), "0");

  const bad = await gateway.request("/api/store/catalog?kind=weapon");
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 1, "잘못된 kind 는 업스트림을 부르지 않는다");
});

test("업스트림 장애는 502 로 보고되고 프로세스를 죽이지 않는다", async () => {
  const fetcher = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const res = await app(fetcher).request("/api/store/catalog");
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /스토어/);
});

/* ── 매니페스트 ───────────────────────────────────────── */

test("매니페스트를 그대로 전달한다", async () => {
  const manifest = { spec: "losia-asset/1", id: "stb33826d1890f", kind: "stage", license: "downloadable", files: [{ role: "base", url: `${LOSIA}/api/assets/stb33826d1890f/files/base`, mime: "image/png" }] };
  const { fetcher, calls } = fakeLosia({ "/api/assets/stb33826d1890f/manifest": () => Response.json(manifest) });
  const res = await app(fetcher).request("/api/store/assets/stb33826d1890f/manifest");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), manifest);
  assert.equal(calls[0]!.url, `${LOSIA}/api/assets/stb33826d1890f/manifest`);
});

test("자산 id 형식이 아니면 업스트림을 부르지 않고 거부한다", async () => {
  const { fetcher, calls } = fakeLosia({});
  const gateway = app(fetcher);
  for (const id of ["..%2F..%2Fapi", "a", "st b33826d1890f"]) {
    const res = await gateway.request(`/api/store/assets/${id}/manifest`);
    assert.equal(res.status, 400, id);
  }
  // `%2e%2e` 는 URL 파서가 먼저 정규화해 라우트 자체에 닿지 않는다(404). 어느 쪽이든 업스트림은 안 부른다.
  assert.equal((await gateway.request("/api/store/assets/%2e%2e/manifest")).status, 404);
  assert.equal(calls.length, 0);
});

/* ── 파일 ─────────────────────────────────────────────── */

function manifestRoutes(license: string, files: { role: string; url?: string }[]) {
  return {
    "/api/assets/stb33826d1890f/manifest": () => Response.json({ spec: "losia-asset/1", id: "stb33826d1890f", kind: "stage", name: "부엌 · 낮", license, files }),
    "/api/assets/stb33826d1890f/files/base": () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }),
  };
}

test("downloadable 등급의 파일 바이트를 그대로 중계한다", async () => {
  const { fetcher, calls } = fakeLosia(manifestRoutes("downloadable", [{ role: "base", url: `${LOSIA}/api/assets/stb33826d1890f/files/base` }]));
  const res = await app(fetcher).request("/api/store/assets/stb33826d1890f/files/base");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
  assert.equal(calls.length, 2, "매니페스트 1회 + 파일 1회");
});

test("표정 role 은 URL 인코딩을 풀어서 찾는다", async () => {
  const { fetcher } = fakeLosia(manifestRoutes("downloadable", [{ role: "expression:슬픔", url: `${LOSIA}/api/assets/stb33826d1890f/files/base` }]));
  const res = await app(fetcher).request(`/api/store/assets/stb33826d1890f/files/${encodeURIComponent("expression:슬픔")}`);
  assert.equal(res.status, 200);
});

test("embedded 등급은 파일을 거부하고 업스트림 파일도 부르지 않는다", async () => {
  const { fetcher, calls } = fakeLosia(manifestRoutes("embedded", [{ role: "base", url: `${LOSIA}/api/assets/stb33826d1890f/files/base` }]));
  const res = await app(fetcher).request("/api/store/assets/stb33826d1890f/files/base");
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /embedded|원본/);
  assert.equal(calls.length, 1, "매니페스트만 보고 파일은 받아오지 않는다");
});

test("매니페스트에 없는 role 은 404, url 이 없는 항목도 403", async () => {
  const gateway = app(fakeLosia(manifestRoutes("downloadable", [{ role: "base", url: `${LOSIA}/api/assets/stb33826d1890f/files/base` }])).fetcher);
  assert.equal((await gateway.request("/api/store/assets/stb33826d1890f/files/pose%3A%EC%83%81%EB%B0%98%EC%8B%A0")).status, 404);

  const gated = app(fakeLosia(manifestRoutes("attribution", [{ role: "base" }])).fetcher);
  assert.equal((await gated.request("/api/store/assets/stb33826d1890f/files/base")).status, 403);
});

/* ── 정책: 스토어 라우트는 읽기 전용 GET ──────────────── */

test("스토어 라우트는 스튜디오 헤더 없이도 열려 있다(전부 읽기)", async () => {
  const { fetcher } = fakeLosia({ "/api/assets": () => Response.json({ items: [], total: 0 }) });
  const res = await app(fetcher).request("/api/store/catalog", { headers: JSON_HEADERS });
  assert.equal(res.status, 200);
});
