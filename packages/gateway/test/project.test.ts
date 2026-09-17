import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { createFileProjectStore, createMemoryProjectStore } from "../src/project/store.js";

const node = {
  id: "hello",
  label: "한 줄",
  beats: [
    { op: "scene" as const, bg: "title", bgm: "main-theme", chapter: "HELLO" },
    { op: "say" as const, who: null, text: "은행나무 그늘." },
  ],
};

test("파일 저장소는 story/nodes/{id}.json 과 vnmaker.json 에 쓴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-ir-"));
  const store = createFileProjectStore(root);
  await store.writeNode(node);
  const saved = JSON.parse(await readFile(join(root, "story", "nodes", "hello.json"), "utf8")) as { id: string };
  assert.equal(saved.id, "hello");
  const meta = JSON.parse(await readFile(join(root, "vnmaker.json"), "utf8")) as { version: number; locale: string };
  assert.equal(meta.version, 1);
  assert.equal(meta.locale, "ko");
  const read = await store.readNode("hello");
  assert.equal(read?.id, "hello");
  const say = read?.beats[1];
  assert.equal(say && say.op === "say" ? say.text : "", "은행나무 그늘.");
});

test("경로 탈출 id 는 파일에 쓰지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-ir-"));
  const store = createFileProjectStore(root);
  await assert.rejects(() => store.writeNode({ ...node, id: "../etc" }), /id/);
  assert.equal(await store.readNode("../etc"), null);
  assert.equal(await store.readNode(".."), null);
});

test("없는 노드는 404", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/project/nodes/hello");
  assert.equal(res.status, 404);
});

test("POST /api/project/nodes 왕복", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/project/nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify(node),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { path: string };
  assert.equal(body.path, "story/nodes/hello.json");
  const get = await app.request("/api/project/nodes/hello");
  assert.equal(get.status, 200);
  const got = (await get.json()) as { node: { id: string } };
  assert.equal(got.node.id, "hello");
});

test("깨진 노드 JSON 은 400", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/project/nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ id: "HELLO", beats: [] }),
  });
  assert.equal(res.status, 400);
});

test("listNodes 는 쓴 노드를 돌려준다", async () => {
  const store = createMemoryProjectStore();
  await store.writeNode(node);
  const listed = await store.listNodes();
  assert.deepEqual(
    listed.map((item) => item.id),
    ["hello"],
  );
});

test("edges 를 왕복한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "vnmaker-ir-"));
  const store = createFileProjectStore(root);
  await store.writeEdges([{ from: "hello", to: "cafe-02" }]);
  const edges = await store.readEdges();
  assert.equal(edges.length, 1);
  assert.equal(edges[0]?.from, "hello");
  assert.equal(edges[0]?.to, "cafe-02");
});

const say = (id: string, extra: Record<string, unknown>[] = []) => ({
  id,
  beats: [{ op: "say" as const, who: null, text: `${id} 대사` }, ...extra],
});

test("GET /api/project/script 는 그래프를 컴파일해 검증된 원고를 준다", async () => {
  const project = createMemoryProjectStore();
  await project.writeNode(say("a"));
  await project.writeNode(say("b", [{ op: "ending", title: "끝" }]));
  await project.writeEdges([{ from: "a", to: "b" }]);
  const app = createApp({ store: createMemoryStore(null), project });
  const res = await app.request("/api/project/script");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { script: { start: string; scenes: { id: string; next?: string; ending?: string }[] }; issues: unknown[] };
  assert.equal(body.script.start, "a");
  assert.equal(body.script.scenes[0]?.next, "b");
  assert.equal(body.script.scenes[1]?.ending, "끝");
  assert.ok(Array.isArray(body.issues));
});

test("GET /api/project/script — 조건 엣지는 routes 로, set 비트는 장면 진입 플래그로 컴파일된다", async () => {
  const project = createMemoryProjectStore();
  await project.writeNode(say("a", [{ op: "set", vars: { metYuna: true } }]));
  await project.writeNode(say("b", [{ op: "ending", title: "b끝" }]));
  await project.writeNode(say("c", [{ op: "ending", title: "c끝" }]));
  await project.writeEdges([{ from: "a", to: "b", when: { all: ["metYuna"] } } as never, { from: "a", to: "c" }]);
  const app = createApp({ store: createMemoryStore(null), project });
  const res = await app.request("/api/project/script");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { script: { scenes: { id: string; set?: unknown; routes?: unknown[]; next?: string }[] } };
  const a = body.script.scenes.find((scene) => scene.id === "a");
  assert.deepEqual(a?.set, { metYuna: true });
  assert.deepEqual(a?.routes, [{ next: "b", when: { all: ["metYuna"] } }]);
  assert.equal(a?.next, "c");
});

test("GET /api/project/script — 노드가 없거나 dangling 엣지면 400", async () => {
  const empty = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  assert.equal((await empty.request("/api/project/script")).status, 400);
  const project = createMemoryProjectStore();
  await project.writeNode(say("a"));
  await project.writeEdges([{ from: "a", to: "ghost" }]);
  const app = createApp({ store: createMemoryStore(null), project });
  const res = await app.request("/api/project/script");
  assert.equal(res.status, 400);
});

test("PUT /api/project/edges — 양 끝 노드를 검증하고 문자열 when 을 정규화한다", async () => {
  const project = createMemoryProjectStore();
  await project.writeNode(say("a"));
  await project.writeNode(say("b"));
  const app = createApp({ store: createMemoryStore(null), project });
  const bad = await app.request("/api/project/edges", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ edges: [{ from: "a", to: "ghost" }] }),
  });
  assert.equal(bad.status, 400);
  const ok = await app.request("/api/project/edges", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ edges: [{ from: "a", to: "b", when: "metYuna" }] }),
  });
  assert.equal(ok.status, 200);
  const edges = await project.readEdges();
  assert.deepEqual(edges[0]?.when, { all: ["metYuna"] });
});
