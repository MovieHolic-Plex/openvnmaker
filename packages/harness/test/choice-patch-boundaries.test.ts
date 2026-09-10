import assert from "node:assert/strict";
import { test } from "node:test";
import { choicePatchSchema, HarnessError, parseToolEnvelope } from "@vnmaker/harness";
import { hash, uuid } from "./fixtures.js";

const envelope = (patch: unknown) => ({ callId: uuid, candidateId: uuid, expectedCandidateRevision: 0,
  tool: "patch_choices", arguments: { sceneId: "start", operations: [
    { kind: "update", choiceId: "shared", expectedEntityHash: hash, patch },
  ] } });

test("B2 rejects choice patch when supplied set and add maps overlap", () => {
  // Given
  const input = { set: { set: { score: 1 }, add: { score: 2 } }, unset: [] };
  // When
  const result = choicePatchSchema.safeParse(input);
  // Then
  assert.equal(result.success, false);
});
test("B2 rejects nested update when one patch supplies contradictory choice effects", () => {
  // Given
  const input = envelope({ set: { set: { score: 1 }, add: { score: 2 } }, unset: [] });
  // When / Then
  assert.throws(() => parseToolEnvelope(input), error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
});
for (const [name, patch] of [
  ["set only", { set: { set: { score: 1 } }, unset: [] }],
  ["add only", { set: { add: { score: 2 } }, unset: [] }],
  ["disjoint effects", { set: { set: { score: 1 }, add: { trust: 2 } }, unset: [] }],
  ["empty set map", { set: { set: {}, add: { score: 2 } }, unset: [] }],
  ["empty add map", { set: { set: { score: 1 }, add: {} }, unset: [] }],
  ["remove retained add", { set: { set: { score: 1 } }, unset: ["add"] }],
  ["remove retained set", { set: { add: { score: 2 } }, unset: ["set"] }],
  ["unrelated partial field", { set: { text: "Changed" }, unset: [] }],
] as const) {
  test(`B2 preserves ${name} when retained candidate fields are unknown`, () => {
    // Given
    const input = envelope(patch);
    // When
    const result = parseToolEnvelope(input);
    // Then
    assert.deepEqual(result, input);
  });
}
