import assert from "node:assert/strict";
import { test } from "node:test";
import type { VnScript } from "@vnmaker/content";
import type { RunCommand } from "@vnmaker/harness";
import { createRunCommandSchema, decisionAckSchema, decisionReceiptSchema, DEFAULT_BUDGET_LIMITS, parseRunCommand,
  reuseAnalysisCommandSchema, RUN_TRANSITIONS, PROPOSAL_TRANSITIONS, runStateSchema } from "@vnmaker/harness";
import { hash, head, productionDocument, script, uuid } from "./fixtures.js";

const budget = { limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only" };
const base = { requestId: uuid, expectedRunVersion: 9 };
const actionFixtures = {
  start: { scope: { kind: "chapter", chapterIds: ["ch1"], unitIds: [uuid] }, reviewDigest: hash, ...budget },
  approve: { stage: "plan", reviewId: uuid, reviewDigest: hash, unitIds: [uuid] },
  "request-changes": { reviewId: uuid, reviewDigest: hash, issueIds: [uuid], instruction: "repair", ...budget },
  pause: { reason: "user" }, resume: { observedSourceHead: head, capabilityBindingHash: hash },
  budget: { ...budget, expectedLimitVersion: 0, reason: "increase" },
  "retry-effect": { effectId: uuid, payloadHash: hash, authorizeReplacement: true }, cancel: { reason: "stop" },
  repropose: { analysisId: uuid, analysisDigest: hash, newBaseHead: head, reuseUnitIds: [uuid], reuseAssetIds: [], resolutions: [] },
} satisfies Record<Exclude<RunCommand["action"], "previews">, unknown>;
test("parses previews when only the immutable candidate revision is supplied", () => {
  // Given: R1 and the R2 preview row specify requestId, not a mutable run version.
  const input = { action: "previews", requestId: uuid, expectedCandidateRevision: 4,
    entry: { kind: "from-start", sceneId: "start" }, allowMissingAssetPlaceholders: false };
  // When
  const result = parseRunCommand(input);
  // Then
  assert.deepEqual(result, input);
});
test("rejects previews when fields outside the snapshot request contract are supplied", () => {
  // Given / When / Then
  assert.throws(() => parseRunCommand({ action: "previews", ...base, expectedCandidateRevision: 4,
    entry: { kind: "from-start", sceneId: "start" }, allowMissingAssetPlaceholders: false }));
});
for (const [action, fields] of Object.entries(actionFixtures)) {
  test(`parses ${action} when command version and action fields are complete`, () => {
    // Given
    const input = { ...base, action, ...fields };
    // When
    const result = parseRunCommand(input);
    // Then
    assert.deepEqual(result, input);
  });
  test(`rejects ${action} when the command contains an unknown field`, () => {
    // Given / When / Then
    assert.throws(() => parseRunCommand({ ...base, action, ...fields, credentials: "forbidden" }));
  });
}
for (const variant of [
  { initialScope: "plan", brief: "Novel", targetMinutes: 240 },
  { initialScope: "edit", selection: { sceneId: "start", lineIds: ["l-a"] }, instruction: "repair" },
  { initialScope: "imported-draft", importedCandidateSeed: { productionDocument, scenes: script.scenes, reviews: [], assetManifest: [], provenance: "imported" }, archiveHash: hash },
]) {
  test(`parses ${variant.initialScope} when creating a run without control version`, () => {
    // Given
    const input = { requestId: uuid, sourceHead: head, script, productionDocument, ...budget, ...variant };
    // When
    const result = createRunCommandSchema.parse(input);
    // Then
    const manuscript: VnScript = result.script;
    assert.deepEqual(manuscript, script);
    assert.deepEqual(result, input);
  });
  test(`rejects ${variant.initialScope} when fields from another create variant are injected`, () => {
    // Given / When
    const result = createRunCommandSchema.safeParse({ requestId: uuid, sourceHead: head, script, productionDocument, ...budget, ...variant, expectedRunVersion: 0 });
    // Then
    assert.equal(result.success, false);
  });
}
for (const source of [{ sourceProposalId: uuid }, { sourceCandidateSnapshotId: uuid }]) {
  test("parses reuse analysis when exactly one immutable source is selected", () => {
    // Given
    const input = { ...base, ...source, sourceDigest: hash, newBaseHead: head, script, productionDocument };
    // When
    const result = reuseAnalysisCommandSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
test("rejects reuse analysis when both source variants are present", () => {
  // Given / When
  const result = reuseAnalysisCommandSchema.safeParse({ ...base, sourceProposalId: uuid, sourceCandidateSnapshotId: uuid,
    sourceDigest: hash, newBaseHead: head, script, productionDocument });
  // Then
  assert.equal(result.success, false);
});
const receiptFields = { receiptId: uuid, projectId: head.projectId, lineageId: head.lineageId,
  proposalId: uuid, proposalDigest: hash, baseHead: head, createdAt: "2026-09-06T00:00:00Z" };
for (const decision of [{ kind: "applied", resultHead: { ...head, revision: 5 } }, { kind: "rejected", resultHead: null }]) {
  test(`parses ${decision.kind} receipt when acknowledging a durable decision without run version`, () => {
    // Given
    const input = { requestId: uuid, decisionReceipt: { ...receiptFields, ...decision } };
    // When
    const result = decisionAckSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
for (const decision of [{ kind: "applied", resultHead: null }, { kind: "rejected", resultHead: head },
  { kind: "applied", resultHead: head }, { kind: "applied", resultHead: { ...head, lineageId: "00000000-0000-4000-8000-000000000002", revision: 5 } }]) {
  test("rejects contradictory receipt when result head cannot represent its decision", () => {
    // Given / When
    const result = decisionReceiptSchema.safeParse({ ...receiptFields, ...decision });
    // Then
    assert.equal(result.success, false);
  });
}
for (const state of [{ status: "planned" }, { status: "idle" }, { status: "running" }, { status: "awaiting-review" },
  { status: "paused", reason: "auth" }, { status: "completed" }, { status: "cancelled" }, { status: "failed", code: "UPSTREAM" }]) {
  test(`parses ${state.status} when lifecycle details match the state`, () => {
    // Given / When
    const result = runStateSchema.parse(state);
    // Then
    assert.deepEqual(result, state);
  });
}
test("defines terminal transitions when completed runs and decided proposals are immutable", () => {
  // Given / When
  const targets = [RUN_TRANSITIONS.completed, RUN_TRANSITIONS.cancelled, RUN_TRANSITIONS.failed,
    PROPOSAL_TRANSITIONS.applied, PROPOSAL_TRANSITIONS.rejected, PROPOSAL_TRANSITIONS.superseded];
  // Then
  assert.deepEqual(targets, [[], [], [], [], [], []]);
});
