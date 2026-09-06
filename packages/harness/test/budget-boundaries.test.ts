import assert from "node:assert/strict";
import { test } from "node:test";
import { admitBudget, budgetLimitsSchema, budgetRequestSchema, DEFAULT_BUDGET_LIMITS, generationUsageSchema, parseSnapshotJson, projectHeadSchema } from "@vnmaker/harness";
import { budgetInput, capability, exactCounter, head, image, zeroCounters } from "./fixtures.js";

for (const field of Object.keys(DEFAULT_BUDGET_LIMITS.request)) {
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    test(`rejects ${field}=${invalid} when parsing request limits`, () => {
      // Given / When
      const result = budgetLimitsSchema.safeParse({ ...DEFAULT_BUDGET_LIMITS, request: { ...DEFAULT_BUDGET_LIMITS.request, [field]: invalid } });
      // Then
      assert.equal(result.success, false);
    });
  }
  test(`enforces ${field} zero semantics when parsing request limits`, () => {
    // Given / When
    const result = budgetLimitsSchema.safeParse({ ...DEFAULT_BUDGET_LIMITS, request: { ...DEFAULT_BUDGET_LIMITS.request, [field]: 0 } });
    // Then
    assert.equal(result.success, field === "imageInputs");
  });
}
for (const scope of ["run", "chapter"] as const) for (const key of ["textAttempts", "imageAttempts", "countRequests"] as const) {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    test(`rejects ${scope}.${key}=${value} when parsing counters`, () => {
      // Given / When
      const result = budgetLimitsSchema.safeParse({ ...DEFAULT_BUDGET_LIMITS, [scope]: { ...DEFAULT_BUDGET_LIMITS[scope], [key]: value } });
      // Then
      assert.equal(result.success, false);
    });
  }
  test(`blocks ${scope}.${key} when its authorized limit is zero`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput,
      limits: { ...DEFAULT_BUDGET_LIMITS, [scope]: { ...DEFAULT_BUDGET_LIMITS[scope], [key]: 0 } }, reserve: { ...zeroCounters, [key]: 1 } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, false);
  });
  test(`admits ${scope}.${key} when reservation exactly reaches the limit`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS,
      reserve: { ...zeroCounters, [key]: 1 }, used: { run: zeroCounters, chapter: zeroCounters,
        [scope]: { ...zeroCounters, [key]: DEFAULT_BUDGET_LIMITS[scope][key] - 1 } } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, true);
  });
}
for (const [field, limit] of [["textContextBytes", 65536], ["wireBodyBytes", 20971520], ["requestedOutputTokens", 8192]] as const) {
  for (const delta of [-1, 0, 1]) {
    test(`checks ${field} boundary ${delta} when measuring the request`, () => {
      // Given
      const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, [field]: limit + delta });
      // When
      const result = admitBudget(input);
      // Then
      assert.equal(result.allowed, delta <= 0);
    });
  }
}
for (const [mode, tokens] of [["input-only", 95904], ["combined", 87712]] as const) for (const delta of [-1, 0, 1]) {
  test(`checks ${mode} token boundary ${delta} when exact counts are available`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS,
      capability: { ...capability, tokenWindowMode: mode }, counter: { ...exactCounter, inputTokens: tokens + delta } });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, delta <= 0);
  });
}
for (const [patch, allowed] of [
  [{ images: Array.from({ length: 4 }, () => image) }, true], [{ images: Array.from({ length: 5 }, () => image) }, false],
  [{ images: [{ ...image, rawBytes: 8 * 1024 * 1024 }] }, true], [{ images: [{ ...image, rawBytes: 8 * 1024 * 1024 + 1 }] }, false],
  [{ images: [{ ...image, rawBytes: 6 * 1024 * 1024 }, { ...image, rawBytes: 6 * 1024 * 1024 }] }, true],
  [{ images: [{ ...image, rawBytes: 6 * 1024 * 1024 }, { ...image, rawBytes: 6 * 1024 * 1024 + 1 }] }, false],
  [{ images: [{ ...image, width: 1025 }] }, false], [{ autoRepairRound: 2 }, true], [{ autoRepairRound: 3 }, false],
  [{ unitAuthorized: false }, false], [{ capability: { ...capability, ready: false } }, false],
] as const) {
  test(`checks independent payload guard when ${JSON.stringify(patch)}`, () => {
    // Given
    const input = budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, ...patch });
    // When
    const result = admitBudget(input);
    // Then
    assert.equal(result.allowed, allowed);
  });
}

test("preserves missing generation usage when provider metadata is absent", () => {
  // Given / When
  const result = generationUsageSchema.parse({ knownInputUsage: null, knownOutputUsage: null });
  // Then
  assert.deepEqual(result, { knownInputUsage: null, knownOutputUsage: null });
});

for (const delta of [0, 1]) test(`enforces snapshot wire limit when body adds ${delta} excess bytes`, () => {
  // Given: whitespace is legal JSON but still costs transport bytes.
  const json = JSON.stringify(head);
  const body = json + " ".repeat(8 * 1024 * 1024 - new TextEncoder().encode(json).byteLength + delta);
  // When / Then
  if (delta === 0) assert.deepEqual(parseSnapshotJson(projectHeadSchema, body), head);
  else assert.throws(() => parseSnapshotJson(projectHeadSchema, body));
});
