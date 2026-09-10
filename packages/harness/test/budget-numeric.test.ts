import assert from "node:assert/strict";
import { test } from "node:test";
import { admitBudget, budgetLimitsSchema, budgetRequestSchema, DEFAULT_BUDGET_LIMITS } from "@vnmaker/harness";
import { budgetInput, capability, exactCounter, image } from "./fixtures.js";

for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  for (const field of ["width", "height", "rawBytes"] as const) {
    test(`rejects measured image ${field}=${value} when parsing request images`, () => {
      // Given / When
      const result = budgetRequestSchema.safeParse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, images: [{ ...image, [field]: value }] });
      // Then
      assert.equal(result.success, false);
    });
  }
  test(`rejects automatic repair limit ${value} when parsing budgets`, () => {
    // Given / When
    const result = budgetLimitsSchema.safeParse({ ...DEFAULT_BUDGET_LIMITS, maxAutoRepairRounds: value });
    // Then
    assert.equal(result.success, false);
  });
}
for (const field of ["inputTokenLimit", "outputTokenLimit", "combinedTokenLimit"] as const) {
  for (const value of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    test(`rejects provider ${field}=${value} when parsing capability limits`, () => {
      // Given / When
      const result = budgetRequestSchema.safeParse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, capability: { ...capability, [field]: value } });
      // Then
      assert.equal(result.success, false);
    });
  }
}
for (const scope of ["run", "chapter"] as const) {
  test(`rejects unsafe ${scope} usage when parsing reserved counters`, () => {
    // Given / When
    const result = budgetRequestSchema.safeParse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS,
      used: { ...budgetInput.used, [scope]: { ...budgetInput.used[scope], countRequests: Number.MAX_SAFE_INTEGER + 1 } } });
    // Then
    assert.equal(result.success, false);
  });
}
for (const field of ["textAttempts", "imageAttempts", "countRequests"] as const) {
  test(`rejects negative reservation ${field} when parsing admission input`, () => {
    // Given / When
    const result = budgetRequestSchema.safeParse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, reserve: { ...budgetInput.reserve, [field]: -1 } });
    // Then
    assert.equal(result.success, false);
  });
}
test("accepts zero counted tokens when exact usage is actually reported as zero", () => {
  // Given
  const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, counter: { ...exactCounter, inputTokens: 0 } });
  // When
  const result = admitBudget(input);
  // Then
  assert.equal(result.countedInputTokens, 0);
  assert.equal(result.tokenCheck, "pass");
});
test("rejects zero requested output when authorizing a generation", () => {
  // Given
  const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, requestedOutputTokens: 0 });
  // When
  const result = admitBudget(input);
  // Then
  assert.equal(result.allowed, false);
});
test("rejects stale capability counting when the payload hash alone still matches", () => {
  // Given
  const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS,
    counter: { ...exactCounter, capabilityBindingHash: "c".repeat(64) } });
  // When
  const result = admitBudget(input);
  // Then
  assert.equal(result.tokenCheck, "unknown");
  assert.equal(result.allowed, false);
});
