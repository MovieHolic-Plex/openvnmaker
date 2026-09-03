import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGenerateRequest, collectText } from "../src/cca/generate.js";
import { parseSseChunks } from "../src/cca/images.js";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { GENERATE_MAX_OUTPUT_TOKENS, TEXT_MODEL } from "../src/config.js";

test("봉투는 project, requestType:agent, TEXT modalities 없음", () => {
  const body = buildGenerateRequest({ prompt: "한 줄", projectId: "aicode-consumers", model: "m" }) as Record<
    string,
    any
  >;
  assert.equal(body["project"], "aicode-consumers");
  assert.equal(body["model"], "m");
  assert.equal(body["requestType"], "agent");
  assert.equal(body["userAgent"], "antigravity");
  assert.equal(body["request"].generationConfig.maxOutputTokens, GENERATE_MAX_OUTPUT_TOKENS);
  assert.equal("responseModalities" in body["request"].generationConfig, false);
  assert.equal(body["request"].contents[0].parts[0].text, "한 줄");
});

test("requestId 는 요청마다 다르다", () => {
  const a = buildGenerateRequest({ prompt: "p", projectId: "x" }) as Record<string, unknown>;
  const b = buildGenerateRequest({ prompt: "p", projectId: "x" }) as Record<string, unknown>;
  assert.notEqual(a["requestId"], b["requestId"]);
});

const sse = [
  `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "캠퍼스" }] } }] } })}`,
  "",
  `data: ${JSON.stringify({
    response: {
      candidates: [{ content: { parts: [{ text: "에 비가 내린다." }] } }],
      usageMetadata: { totalTokenCount: 9 },
    },
  })}`,
  "",
  "data: [DONE]",
  "",
  `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "무시" }] } }] } })}`,
  "",
].join("\n");

test("SSE 텍스트를 이어 붙이고 [DONE] 이후는 버린다", () => {
  const parsed = collectText(parseSseChunks(sse));
  assert.equal(parsed.text, "캠퍼스에 비가 내린다.");
  assert.equal(parsed.usage?.["totalTokenCount"], 9);
});

test("thought:true 조각은 대사로 치지 않는다", () => {
  const parsed = collectText(
    parseSseChunks(
      [
        `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ thought: true, text: "분석 중" }] } }] } })}`,
        "",
        `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "은행나무 그늘." }] } }] } })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
    ),
  );
  assert.equal(parsed.text, "은행나무 그늘.");
});

test("blockReason 을 올려 보낸다", () => {
  const blocked = collectText(
    parseSseChunks(`data: ${JSON.stringify({ response: { promptFeedback: { blockReason: "SAFETY" } } })}\n\n`),
  );
  assert.equal(blocked.blockReason, "SAFETY");
  assert.equal(blocked.text, "");
});

test("로그인 없이 generate 는 401", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "p" }),
  });
  assert.equal(res.status, 401);
});

test("빈 prompt 여도 로그인만 없으면 401 이다 (기본 프롬프트를 쓴다)", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

test("prompt 가 2000자를 넘으면 400", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
  });
  const res = await app.request("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "가".repeat(2001) }),
  });
  assert.equal(res.status, 400);
});

test("generate/config 는 기본 모델과 공유 쿼터 경고를 준다", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const body = (await (await app.request("/api/generate/config")).json()) as Record<string, unknown>;
  assert.equal(body["model"], TEXT_MODEL);
  assert.equal(body["quotaShared"], true);
  assert.equal(body["unofficial"], true);
});
