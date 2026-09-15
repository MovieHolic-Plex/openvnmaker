/**
 * 2026-09 적대적 리뷰 수정분의 회귀 테스트.
 * 잡는 결함: CSRF(simple request POST), 손상 삼킴, 비원자적 쓰기, 토큰 갱신 경합,
 * dangling 엣지, 에이전트 실패 마스킹, 바디 크기 무제한.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createFileStore, createMemoryStore } from "../src/auth/credentials.js";
import { ensureFreshAccess } from "../src/auth/tokens.js";
import { runAgentTurn } from "../src/agent/run.js";
import { executeTool } from "../src/agent/tools.js";
import { createFileProjectStore, createMemoryProjectStore } from "../src/project/store.js";

const STUDIO = { "Content-Type": "application/json", "X-VNMaker-Studio": "1" } as const;

// 이 파일의 이미지 검증은 agy 경로의 모델 허용 목록을 본다 — codex 기본 백엔드와 분리.
process.env.VNMAKER_IMAGE_BACKEND = "agy";

const hello = {
  id: "hello",
  label: "한 줄",
  beats: [
    { op: "scene" as const, bg: "title", bgm: "main-theme", chapter: "HELLO" },
    { op: "say" as const, who: null, text: "은행나무 그늘이 따뜻하다." },
  ],
};

/* ── CSRF: 스튜디오 헤더 요구 ───────────────────────────── */

test("스튜디오 헤더 없는 POST 는 403 — simple request CSRF 차단", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  for (const path of ["/api/auth/login", "/api/auth/refresh", "/api/generate", "/api/image/generate", "/api/project/nodes", "/api/agent/run"]) {
    // text/plain = preflight 없이 나가는 simple request 와 같은 형태
    const res = await app.request(path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(res.status, 403, path);
  }
});

test("헤더 없는 GET 은 연다(읽기는 CSRF 부수효과가 없다)", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  assert.equal((await app.request("/api/health")).status, 200);
  assert.equal((await app.request("/api/auth/status")).status, 200);
});

test("헤더 있는 POST 는 라우트까지 도달한다", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/auth/refresh", { method: "POST", headers: STUDIO });
  assert.equal(res.status, 401); // 403 이 아니라 자격증명 없음 401 까지 간다
});

/* ── 손상은 null/[] 이 아니라 오류 ─────────────────────── */

test("손상된 노드 파일은 null 이 아니라 오류로 보고한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-corrupt-"));
  await mkdir(join(root, "story", "nodes"), { recursive: true });
  await writeFile(join(root, "story", "nodes", "hello.json"), '{"id":"hello","beats":[', "utf8");
  const store = createFileProjectStore(root);
  await assert.rejects(() => store.readNode("hello"), /손상/);
  await assert.rejects(() => store.listNodes(), /손상/);
  // 없는 노드는 여전히 null 이다 — 손상과 부재는 다르다
  assert.equal(await store.readNode("missing"), null);
});

test("손상된 edges.json 을 updateEdges 가 덮어쓰지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-corrupt-"));
  await mkdir(join(root, "story"), { recursive: true });
  const broken = '{"edges":[{"from":"a"';
  const file = join(root, "story", "edges.json");
  await writeFile(file, broken, "utf8");
  const store = createFileProjectStore(root);
  await assert.rejects(() => store.readEdges(), /손상/);
  await assert.rejects(() => store.updateEdges((edges) => [...edges, { from: "a", to: "b" }]), /손상/);
  // 파일이 그대로 남아 복구 가능해야 한다 — 이전 동작은 [] 로 읽고 새 엣지만 써서 전부 날렸다
  assert.equal(await readFile(file, "utf8"), broken);
});

test("connect 도구는 손상된 edges.json 에서 오류를 낸다", async () => {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-corrupt-"));
  const store = createFileProjectStore(root);
  await store.writeNode(hello);
  await writeFile(join(root, "story", "edges.json"), "{not json", "utf8");
  const result = await executeTool(store, "connect", { from: "hello", to: "hello" });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /손상/);
});

/* ── 쓰기 검증과 직렬화 ───────────────────────────────── */

test("알 수 없는 beat op 는 디스크에 기록되지 않는다", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/project/nodes", {
    method: "POST",
    headers: STUDIO,
    body: JSON.stringify({ id: "bad", beats: [{ op: "bogus" }] }),
  });
  assert.equal(res.status, 400);
});

test("updateEdges 는 동시 호출을 직렬화해 한쪽 엣지를 잃지 않는다", async () => {
  const store = createMemoryProjectStore([hello]);
  await Promise.all([
    store.updateEdges((edges) => [...edges, { from: "hello", to: "x" }]),
    store.updateEdges((edges) => [...edges, { from: "hello", to: "y" }]),
  ]);
  const edges = await store.readEdges();
  assert.equal(edges.length, 2);
  assert.deepEqual(
    edges.map((edge) => edge.to).sort(),
    ["x", "y"],
  );
});

/* ── 토큰 갱신 single-flight ──────────────────────────── */

test("만료된 자격증명의 동시 갱신은 refresh 를 한 번만 날린다", async () => {
  const store = createMemoryStore({ refresh: "r0", access: "old", expires: Date.now() - 1000, projectId: "p" });
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ access_token: `new-${fetches}`, expires_in: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const [a, b, c] = await Promise.all([ensureFreshAccess(store), ensureFreshAccess(store), ensureFreshAccess(store)]);
    assert.equal(fetches, 1);
    assert.equal(a?.credentials.access, "new-1");
    assert.equal(b?.credentials.access, "new-1");
    assert.equal(c?.credentials.access, "new-1");
    assert.equal((await store.read())?.access, "new-1");
  } finally {
    globalThis.fetch = original;
  }
});

test("유효한 자격증명은 refresh 없이 그대로 돌아온다", async () => {
  const store = createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" });
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  try {
    const result = await ensureFreshAccess(store);
    assert.equal(result?.refreshed, false);
    assert.equal(result?.credentials.access, "a");
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = original;
  }
});

/* ── 원자적 쓰기 ──────────────────────────────────────── */

test("자격증명 쓰기는 tmp 잔여물 없이 온전한 JSON 을 남긴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-atomic-"));
  const path = join(root, "auth.json");
  const store = createFileStore(path);
  await store.write({ refresh: "r", access: "a", expires: 1, projectId: "p" });
  const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, { access: string }>;
  assert.equal(parsed["google-antigravity"]?.access, "a");
  assert.equal((await readdir(root)).filter((name) => name.endsWith(".tmp")).length, 0);
});

/* ── 에이전트 실패 마스킹 해제 ────────────────────────── */

test("도구가 전부 실패하면 failures 에 드러나고 playFrom 은 null 이다", async () => {
  const project = createMemoryProjectStore([hello]);
  let step = 0;
  const result = await runAgentTurn({
    message: "hello 를 ghost 에 연결해라",
    nodeId: "hello",
    project,
    model: async () => {
      step += 1;
      if (step === 1) return { calls: [{ name: "connect", args: { from: "hello", to: "ghost" } }] };
      return { calls: [] };
    },
  });
  assert.equal(result.diffs.length, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.tool, "connect");
  assert.equal(result.playFrom, null);
  assert.equal(result.node, null);
  assert.match(result.text, /실패/);
});

test("play_from 을 부르지 않으면 playFrom 미리보기를 꾸미지 않는다", async () => {
  const project = createMemoryProjectStore([hello]);
  const result = await runAgentTurn({
    message: "읽기만",
    nodeId: "hello",
    project,
    model: async () => ({ text: "읽었다.", calls: [] }),
  });
  assert.equal(result.playFrom, null);
  assert.equal(result.node, null);
});

test("agent/run 응답이 failures 를 노출한다", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
    project: createMemoryProjectStore([hello]),
    agentModel: async () => ({ calls: [{ name: "connect", args: { from: "hello", to: "ghost" } }] }),
  });
  const res = await app.request("/api/agent/run", {
    method: "POST",
    headers: STUDIO,
    body: JSON.stringify({ message: "연결해라" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { failures: { tool: string; error: string }[]; playFrom: string | null };
  assert.equal(body.failures.length >= 1, true);
  assert.equal(body.failures[0]?.tool, "connect");
  assert.equal(body.playFrom, null);
});

/* ── 바디 크기 상한 ───────────────────────────────────── */

test("4MB 를 넘는 바디는 413", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/project/nodes", {
    method: "POST",
    headers: STUDIO,
    body: JSON.stringify({ id: "big", beats: [{ op: "say", who: null, text: "가".repeat(4 * 1024 * 1024) }] }),
  });
  assert.equal(res.status, 413);
});

/* ── 이미지 경로 비대칭 검증 해소 ─────────────────────── */

test("image/generate 도 prompt 한도와 모델·imageSize 검증을 한다", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
  });
  const post = (body: unknown) =>
    app.request("/api/image/generate", { method: "POST", headers: STUDIO, body: JSON.stringify(body) });
  assert.equal((await post({ prompt: "가".repeat(16_001) })).status, 400);
  assert.equal((await post({ prompt: "p", model: "strange-model" })).status, 400);
  assert.equal((await post({ prompt: "p", imageSize: "8K" })).status, 400);
});

test("generate 도 model 패스스루를 막는다", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
  });
  const res = await app.request("/api/generate", {
    method: "POST",
    headers: STUDIO,
    body: JSON.stringify({ prompt: "p", model: "strange-model" }),
  });
  assert.equal(res.status, 400);
});

/* ── 사이트 간 이미지 임베드 ─────────────────────────── */

test("cross-site 요청은 이미지 파일 조회 전에 차단된다", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/image/file/any.png", { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(res.status, 403); // 404 가 아니다 — 파일 존재 여부도 새지 않는다
  const same = await app.request("/api/image/file/any.png", { headers: { "sec-fetch-site": "same-origin" } });
  assert.equal(same.status, 404); // 같은 출처는 정상적으로 404 까지 간다
});
