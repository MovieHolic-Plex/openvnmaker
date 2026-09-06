import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BUDGET_LIMITS, parseProposal, parseRun, runStateSchema, unitSchema } from "@vnmaker/harness";
import { hash, head, insert, uuid } from "./fixtures.js";

const contextManifest = { sourceHead: head, inputContentHash: hash, windows: [], facts: [], readSet: [], referenceBindingHashes: [], excluded: [] };
const provenance = { originHead: head, inputContentHash: hash, readSet: [], writeSet: [], outputArtifactHash: hash, modelBindingHash: hash, referenceBindingHashes: [] };
for (const state of [{ status: "pending" }, { status: "running" }, { status: "ready", provenance },
  { status: "failed", code: "UPSTREAM" }, { status: "cancelled" }, { status: "blocked", reason: "missing-asset" }]) {
  test(`parses unit ${state.status} when durable state details are complete`, () => {
    // Given
    const input = { id: uuid, kind: "scene-draft", dependencyHashes: [], contextManifest, autoRepairRound: 0, ...state };
    // When
    const result = unitSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
for (const reason of ["auth", "quota", "capability", "budget", "interrupted", "unknown-effect", "validation", "stale-source", "user"]) {
  test(`parses pause ${reason} when the run is paused`, () => {
    // Given / When
    const result = runStateSchema.parse({ status: "paused", reason });
    // Then
    assert.deepEqual(result, { status: "paused", reason });
  });
}
test("parses an idle run when its separate control and event versions are present", () => {
  // Given
  const input = { schemaVersion: 1, id: uuid, version: 4, sourceHead: head, candidateRef: { candidateId: uuid, revision: 7 },
    state: { status: "idle" }, units: [], proposalIds: [], budgetGroupId: uuid, budgetOwnerRunId: uuid, limitVersion: 2,
    limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only", lastEventSeq: 99, ownerEpoch: 3, createdAt: "2026-09-06T00:00:00Z" };
  // When
  const result = parseRun(input);
  // Then
  assert.deepEqual(result, input);
});
test("parses a proposal when its immutable operations and required assets are bound", () => {
  // Given
  const input = { id: uuid, runId: uuid, baseHead: head, operations: [insert], requiredAssetHashes: [hash],
    contextManifestHash: hash, validation: { schema: true, graph: true, assets: true, runtime: true, requiredAssetsMissing: [], issues: [], reviewIds: [] }, digest: hash };
  // When
  const result = parseProposal(input);
  // Then
  assert.deepEqual(result, input);
});
