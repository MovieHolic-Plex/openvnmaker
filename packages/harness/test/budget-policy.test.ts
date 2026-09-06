import assert from "node:assert/strict";
import { test } from "node:test";
import { admitBudget, budgetAdmissionSchema, budgetLimitsSchema, budgetRequestSchema, DEFAULT_BUDGET_LIMITS } from "@vnmaker/harness";
import { budgetInput, capability, exactCounter, image } from "./fixtures.js";

for (const capabilityPatch of [{ tokenWindowMode: "unknown" }, { inputTokenLimit: null }, { counterSupport: "unsupported" }]) {
  for (const policy of ["exact-only", "bounded-payload"] as const) {
    test(`retains unknown when provider semantics are ${JSON.stringify(capabilityPatch)} under ${policy}`, () => {
      // Given
      const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, policy,
        boundedPayloadApproved: true, capability: { ...capability, ...capabilityPatch } });
      // When
      const result = admitBudget(input);
      // Then
      assert.equal(result.tokenCheck, "unknown");
      assert.equal(result.allowed, policy === "bounded-payload");
    });
  }
}
for (const key of ["text", "tools", "history", "opaque", "images"] as const) {
  test(`requires ${key} counter coverage when counting a multimodal request`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, images: [image],
      counter: { ...exactCounter, includes: { ...exactCounter.includes, [key]: false } } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.countedInputTokens, null);
    assert.equal(result.tokenCheck, "unknown");
  });
}
for (const policy of ["exact-only", "bounded-payload"] as const) {
  test(`rejects known token failure when policy is ${policy}`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, policy, boundedPayloadApproved: true,
      counter: { ...exactCounter, inputTokens: 100000 } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, false);
    assert.equal(result.tokenCheck, "fail");
  });
  test(`rejects raw image aggregate when policy is ${policy}`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, policy, boundedPayloadApproved: true,
      images: [image, image].map(row => ({ ...row, rawBytes: 6 * 1024 * 1024 + 1 })) });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.reason, "ALL_IMAGE_BYTES_LIMIT");
  });
}
for (const delta of [0, 1]) {
  test(`enforces decoded pixel guard when image exceeds it by ${delta}`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput,
      limits: { ...DEFAULT_BUDGET_LIMITS, request: { ...DEFAULT_BUDGET_LIMITS.request, referenceMaxEdge: 16777217 } },
      images: [{ ...image, width: 16777216 + delta, height: 1 }] });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, delta === 0);
  });
}
for (const requestLimits of [{ imageInputs: 0 }, { textContextBytes: 100 }, { wireBodyBytes: 100 },
  { singleImageRawBytes: 100 }, { allImageRawBytes: 100 }, { maxImagePixels: 100 }, { referenceMaxEdge: 100 }, { maxOutputTokens: 100 }]) {
  test(`honors smaller catalog limits when ${JSON.stringify(requestLimits)}`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, images: [image], capability: { ...capability, requestLimits } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, false);
  });
}
for (const request of [{ imageInputs: 5 }, { wireBodyBytes: 20971521 }]) {
  test("rejects transport guard increases when changing budgets", () => {
    // Given / When
    const result = budgetLimitsSchema.safeParse({ ...DEFAULT_BUDGET_LIMITS, request: { ...DEFAULT_BUDGET_LIMITS.request, ...request } });
    // Then
    assert.equal(result.success, false);
  });
}
for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  for (const field of ["textContextBytes", "wireBodyBytes", "requestedOutputTokens", "autoRepairRound", "limitVersion"]) {
    test(`rejects measured ${field}=${invalid} when parsing budget input`, () => {
      // Given / When
      const result = budgetRequestSchema.safeParse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, [field]: invalid });
      // Then
      assert.equal(result.success, false);
    });
  }
  test(`rejects input count ${invalid} when the provider claims an exact result`, () => {
    // Given / When
    const result = budgetRequestSchema.safeParse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, counter: { ...exactCounter, inputTokens: invalid } });
    // Then
    assert.equal(result.success, false);
  });
}
for (const patch of [{ policy: "silent-fallback" }, { policy: undefined }, { counter: { kind: "guess", inputTokens: 1 } },
  { capability: { ...capability, tokenWindowMode: "context" } }, { allowed: true }, { limits: { ...DEFAULT_BUDGET_LIMITS, unexpected: true } }]) {
  test("rejects unknown budget data when an untrusted boundary is parsed", () => {
    // Given / When
    const result = budgetRequestSchema.safeParse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, ...patch });
    // Then
    assert.equal(result.success, false);
  });
}
test("preserves byte token distinction when provider counts seven thousand tokens", () => {
  // Given
  const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, counter: { ...exactCounter, inputTokens: 7000 } });
  // When
  const result = budgetAdmissionSchema.parse(admitBudget(input));
  // Then
  assert.equal(result.textContextBytes, 30000);
  assert.equal(result.countedInputTokens, 7000);
});
test("blocks automated repair when the feature has a zero limit", () => {
  // Given
  const input = budgetRequestSchema.parse({ ...budgetInput, limits: { ...DEFAULT_BUDGET_LIMITS, maxAutoRepairRounds: 0 }, autoRepairRound: 1 });
  // When
  const result = admitBudget(input);
  // Then
  assert.equal(result.reason, "REPAIR_ROUNDS_LIMIT");
});
