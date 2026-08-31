import assert from "node:assert/strict";
import { test } from "node:test";
import { mapModels } from "../src/cca/client.js";

// 업스트림 fetchAvailableModels 가 주는 모양을 그대로 흉내낸 표본.
const raw = {
  "gemini-3-flash": {
    displayName: "Gemini 3 Flash",
    modelProvider: "MODEL_PROVIDER_GOOGLE",
    supportsThinking: true,
    supportsImages: true,
    recommended: true,
    quotaInfo: { remainingFraction: 0.42, resetTime: "2026-08-31T04:39:58Z" },
  },
  "claude-sonnet-4-6": {
    apiProvider: "MODEL_PROVIDER_ANTHROPIC",
    quotaInfo: { remainingFraction: 1 },
  },
  "no-quota-model": { displayName: "쿼터 없는 모델" },
};

test("모델은 id 사전순으로 정렬된다", () => {
  assert.deepEqual(mapModels(raw).map((m) => m.id), ["claude-sonnet-4-6", "gemini-3-flash", "no-quota-model"]);
});

test("쿼터는 업스트림과 같은 quotaInfo.remainingFraction 이름으로 나온다", () => {
  const byId = new Map(mapModels(raw).map((m) => [m.id, m]));
  assert.equal(byId.get("gemini-3-flash")?.quotaInfo?.remainingFraction, 0.42);
  assert.equal(byId.get("gemini-3-flash")?.quotaInfo?.resetTime, "2026-08-31T04:39:58Z");
  assert.equal(byId.get("claude-sonnet-4-6")?.quotaInfo?.remainingFraction, 1);
  // resetTime 이 없으면 키 자체를 만들지 않는다.
  assert.ok(!("resetTime" in (byId.get("claude-sonnet-4-6")?.quotaInfo ?? {})));
});

test("쿼터가 없는 모델은 quotaInfo 키를 달지 않는다", () => {
  const entry = mapModels(raw).find((m) => m.id === "no-quota-model");
  assert.ok(entry);
  assert.ok(!("quotaInfo" in entry));
});

test("provider 는 modelProvider 를 먼저, 없으면 apiProvider 를 쓴다", () => {
  const byId = new Map(mapModels(raw).map((m) => [m.id, m]));
  assert.equal(byId.get("gemini-3-flash")?.provider, "MODEL_PROVIDER_GOOGLE");
  assert.equal(byId.get("claude-sonnet-4-6")?.provider, "MODEL_PROVIDER_ANTHROPIC");
});

test("빈 응답이어도 던지지 않고 빈 배열", () => {
  assert.deepEqual(mapModels(undefined), []);
  assert.deepEqual(mapModels({}), []);
});
