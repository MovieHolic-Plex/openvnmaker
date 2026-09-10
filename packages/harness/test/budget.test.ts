import assert from "node:assert/strict";
import { test } from "node:test";
import { admitBudget, budgetRequestSchema, DEFAULT_BUDGET_LIMITS } from "@vnmaker/harness";
import { budgetInput, capability, exactCounter, image, zeroCounters } from "./fixtures.js";

for (const [mode, allowed] of [["input-only", true], ["combined", false]] as const) {
  test(`applies ${mode} tokens when I90000 O8192 S4096 L100000`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, capability: { ...capability, tokenWindowMode: mode } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, allowed);
    assert.equal(result.countedInputTokens, 90000);
    assert.equal(result.textContextBytes, 30000);
  });
}
for (const [policy, approved, allowed] of [["exact-only", false, false], ["bounded-payload", false, false], ["bounded-payload", true, true]] as const) {
  test(`preserves unknown token status when ${policy} approval=${approved}`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, images: [image, image, image, image],
      counter: { kind: "unsupported" }, policy, boundedPayloadApproved: approved });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, allowed);
    assert.equal(result.tokenCheck, "unknown");
    assert.equal(result.countedInputTokens, null);
    assert.equal(result.authorization, allowed ? "bounded-payload-approved" : null);
  });
}
for (const [field, value] of [["textContextBytes", 65537], ["wireBodyBytes", 20971521], ["requestedOutputTokens", 8193]] as const) {
  test(`rejects excess ${field} when a request exceeds its limit`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, [field]: value });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, false);
  });
}
for (const counter of [{ ...exactCounter, requestPayloadHash: "c".repeat(64) }, { ...exactCounter, includes: { ...exactCounter.includes, opaque: false } }]) {
  test("reports unknown when counter payload or coverage is not exact", () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, counter });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.tokenCheck, "unknown");
    assert.equal(result.allowed, false);
  });
}
for (const code of ["auth", "quota", "transport"] as const) {
  test(`does not bypass counter ${code} when bounded payload is approved`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, counter: { kind: "error", code }, policy: "bounded-payload", boundedPayloadApproved: true });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, false);
    assert.equal(result.reason, `COUNTER_${code.toUpperCase()}`);
  });
}
for (const scope of ["run", "chapter"] as const) for (const key of ["textAttempts", "imageAttempts", "countRequests"] as const) {
  test(`rejects ${scope} ${key} when all authorized attempts are reserved`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS,
      reserve: { ...zeroCounters, [key]: 1 }, used: { run: zeroCounters, chapter: zeroCounters, [scope]: { ...zeroCounters, [key]: DEFAULT_BUDGET_LIMITS[scope][key] } } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, false);
  });
}
