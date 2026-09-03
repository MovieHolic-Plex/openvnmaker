import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { runAgentTurn } from "../src/agent/run.js";
import { executeTool } from "../src/agent/tools.js";
import { buildAgentRequest, collectAgentOutput, parseToolJson } from "../src/cca/agent.js";
import { createMemoryProjectStore } from "../src/project/store.js";

const hello = {
  id: "hello",
  label: "한 줄",
  beats: [
    { op: "scene" as const, bg: "title", bgm: "main-theme", chapter: "HELLO" },
    { op: "say" as const, who: null, text: "은행나무 그늘이 따뜻하다." },
  ],
};

const coldBeats = [
  { op: "scene", bg: "title", bgm: "main-theme", chapter: "HELLO" },
  { op: "say", who: null, text: "바람이 차갑다." },
];

test("없는 도구는 거절한다", async () => {
  const project = createMemoryProjectStore();
  const result = await executeTool(project, "rm", { path: "/tmp" });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /도구/);
});

test("upsert_beats 다음에 read_node 가 새 대사를 준다", async () => {
  const project = createMemoryProjectStore([hello]);
  const written = await executeTool(project, "upsert_beats", { nodeId: "hello", beats: coldBeats });
  assert.equal(written.ok, true);
  assert.equal(written.diff?.includes("차갑다"), true);
  const read = await executeTool(project, "read_node", { id: "hello" });
  assert.equal(read.ok, true);
  assert.equal(JSON.stringify(read.data).includes("차갑다"), true);
});

test("connect 는 그래프에 엣지를 남긴다", async () => {
  const project = createMemoryProjectStore([hello]);
  const result = await executeTool(project, "connect", { from: "hello", to: "cafe-02" });
  assert.equal(result.ok, true);
  const graph = await executeTool(project, "list_graph", {});
  assert.equal(JSON.stringify(graph.data).includes("cafe-02"), true);
});

test("가짜 모델이 upsert_beats 를 부르면 디스크와 PLAY 커서가 바뀐다", async () => {
  const project = createMemoryProjectStore([hello]);
  let step = 0;
  const result = await runAgentTurn({
    message: "이 대사만 더 차갑게",
    nodeId: "hello",
    project,
    model: async () => {
      step += 1;
      if (step === 1) return { calls: [{ name: "read_node", args: { id: "hello" } }] };
      if (step === 2) {
        return { calls: [{ name: "upsert_beats", args: { nodeId: "hello", beats: coldBeats } }] };
      }
      return { text: "선택 중인 말만 바꿨다.", calls: [{ name: "play_from", args: { nodeId: "hello" } }] };
    },
  });
  assert.equal(result.playFrom, "hello");
  assert.equal(result.diffs.some((diff) => diff.tool === "upsert_beats"), true);
  const node = await project.readNode("hello");
  assert.equal(JSON.stringify(node?.beats).includes("차갑다"), true);
  assert.equal(JSON.stringify(node?.beats).includes("따뜻하다"), false);
});

test("로그인 없이 agent/run 은 401", async () => {
  const app = createApp({ store: createMemoryStore(null), project: createMemoryProjectStore() });
  const res = await app.request("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "더 차갑게" }),
  });
  assert.equal(res.status, 401);
});

test("빈 지시는 400", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
    project: createMemoryProjectStore([hello]),
    agentModel: async () => ({ calls: [] }),
  });
  const res = await app.request("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(res.status, 400);
});

test("주입한 모델로 agent/run 이 노드를 고친다", async () => {
  const project = createMemoryProjectStore([hello]);
  let step = 0;
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
    project,
    agentModel: async () => {
      step += 1;
      if (step === 1) return { calls: [{ name: "upsert_beats", args: { nodeId: "hello", beats: coldBeats } }] };
      return { text: "바꿨다.", calls: [{ name: "play_from", args: { nodeId: "hello" } }] };
    },
  });
  const res = await app.request("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "더 차갑게", nodeId: "hello" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { playFrom: string; diffs: { tool: string }[]; node: { beats: unknown[] } };
  assert.equal(body.playFrom, "hello");
  assert.equal(body.diffs.some((diff) => diff.tool === "upsert_beats"), true);
  assert.equal(JSON.stringify(body.node.beats).includes("차갑다"), true);
});

test("functionCall 조각을 모은다", () => {
  const parsed = collectAgentOutput([
    {
      response: {
        candidates: [{ content: { parts: [{ functionCall: { name: "read_node", args: { id: "hello" } } }] } }],
      },
    },
  ]);
  assert.equal(parsed.calls[0]?.name, "read_node");
  assert.equal((parsed.calls[0]?.args["id"] as string | undefined) ?? "", "hello");
});

test("본문 JSON 도구를 읽는다", () => {
  const calls = parseToolJson('```json\n{"tool":"play_from","args":{"nodeId":"hello"}}\n```');
  assert.equal(calls[0]?.name, "play_from");
  assert.equal(calls[0]?.args["nodeId"], "hello");
});

test("에이전트 봉투에 tools 와 VALIDATED 가 있다", () => {
  const body = buildAgentRequest({ prompt: "p", projectId: "x", history: [] }) as {
    request: { tools: { functionDeclarations: unknown[] }[]; toolConfig: { functionCallingConfig: { mode: string } } };
  };
  assert.equal(body.request.toolConfig.functionCallingConfig.mode, "VALIDATED");
  assert.equal(body.request.tools[0]?.functionDeclarations.length, 5);
});
