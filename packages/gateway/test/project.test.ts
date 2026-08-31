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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "HELLO", beats: [] }),
  });
  assert.equal(res.status, 400);
});
