import assert from "node:assert/strict";
import { test } from "node:test";
import { admitBudget, artTargetSchema, budgetRequestSchema, canonEntrySchema, canonSectionSchema, DEFAULT_BUDGET_LIMITS,
  effectSchema, issueSchema, previewSnapshotSchema, readDependencySchema, releaseSnapshotSchema, resolutionSchema,
  reviewRecordSchema, reuseAnalysisSchema, scriptSchema, toolArgumentsSchemas } from "@vnmaker/harness";
import { budgetInput, hash, head, outline, script, uuid } from "./fixtures.js";

for (const input of [{ kind: "entries", entries: [] }, { kind: "outline", outline }, { kind: "art-direction", rules: [] }]) {
  test(`parses canon ${input.kind} when the section has a supported tag`, () => {
    // Given / When
    const result = canonSectionSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
const canon = { id: "voice", category: "voice", text: "A deliberate cadence", characterIds: ["hero"], sceneIds: [], relatedEntryIds: [] };
for (const truth of [{ kind: "world" }, { kind: "belief", holderCharacterId: "hero" }, { kind: "rumour" }]) {
  test(`parses ${truth.kind} when canon distinguishes knowledge from facts`, () => {
    // Given / When
    const result = canonEntrySchema.parse({ ...canon, truth });
    // Then
    assert.deepEqual(result.truth, truth);
  });
}
test("rejects belief when its holder is missing", () => {
  // Given / When
  const result = canonEntrySchema.safeParse({ ...canon, truth: { kind: "belief" } });
  // Then
  assert.equal(result.success, false);
});
for (const input of [{ kind: "character", characterId: "hero" }, { kind: "scene", sceneId: "s", slot: "cg" }]) {
  test(`parses art target ${input.kind} when target fields match its tag`, () => {
    // Given / When
    const result = artTargetSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
for (const role of ["reference", "expression", "pose", "background", "cg"] as const) {
  test(`rejects ${role} when its art target role is incompatible`, () => {
    // Given
    const target = ["background", "cg"].includes(role) ? { kind: "character", characterId: "hero" } : { kind: "scene", sceneId: "s", slot: "background" };
    // When
    const result = toolArgumentsSchemas.request_art.safeParse({ assetRequestId: "a", kind: role, target, referenceBindingIds: [], brief: "a" });
    // Then
    assert.equal(result.success, false);
  });
}
for (const dependency of [
  { kind: "entity", target: { kind: "scene", sceneId: "s" }, hash },
  { kind: "membership", scope: { kind: "project" }, ids: ["s"], hash },
  { kind: "order", scope: { kind: "scene", sceneId: "s" }, ids: ["a", "b"], hash },
  { kind: "query", query: "secret", scope: [{ kind: "project" }], resultIds: ["a"], hash },
]) {
  test(`preserves ${dependency.kind} when parsing a recorded read dependency`, () => {
    // Given / When
    const result = readDependencySchema.parse(dependency);
    // Then
    assert.deepEqual(result, dependency);
  });
}
for (const resolution of [
  { kind: "keep-source", operationIds: [uuid] },
  { kind: "use-candidate-fields", operationId: uuid, target: { kind: "line", sceneId: "s", lineId: "a" }, expectedCurrentEntityHash: hash, fields: ["text"] },
  { kind: "insert-as-new", sourceArtifactId: uuid, sceneId: "s", gap: { leftId: null, rightId: null }, clientKey: "key" },
  { kind: "regenerate-unit", unitId: uuid, issueIds: [uuid] },
]) {
  test(`parses resolution ${resolution.kind} when reuse requires explicit choice`, () => {
    // Given / When
    const result = resolutionSchema.parse(resolution);
    // Then
    assert.deepEqual(result, resolution);
  });
}
for (const classification of ["eligible", "needs-review", "conflict", "unavailable"] as const) {
  test(`preserves ${classification} when parsing reuse analysis`, () => {
    // Given
    const input = { analysisId: uuid, analysisDigest: hash, sourceDigest: hash, newBaseHead: head,
      units: [{ unitId: uuid, classification, reasons: [], changedDependencies: [] }],
      assets: [{ assetId: "a", classification, reasons: [] }], requiredReviews: [], requiredRepairs: [] };
    // When
    const result = reuseAnalysisSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
for (const disposition of ["pass", "changes-required", "unverified", "accepted-with-notes"] as const) {
  test(`preserves review ${disposition} when parsing review records`, () => {
    // Given
    const input = { reviewId: uuid, candidateDigest: hash, kind: "chapter", scope: { chapterIds: [], sceneIds: [], lines: [], choices: [], assetIds: [] }, coverage: [], checks: [], issues: [], disposition };
    // When
    const result = reviewRecordSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
for (const severity of ["blocking", "repair", "note"] as const) {
  test(`preserves ${severity} when an issue records scoped evidence`, () => {
    // Given
    const input = { id: uuid, repairFamilyId: uuid, category: "voice", severity, targets: [{ kind: "line", sceneId: "s", lineId: "a" }], evidence: [], requestedChange: "repair" };
    // When
    const result = issueSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
const admission = admitBudget(budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS }));
for (const entry of [{ kind: "from-start", sceneId: "start" }, { kind: "assumed-state", sceneId: "start", flags: { score: 2 } }]) {
  test(`parses preview ${entry.kind} when the snapshot records private boundaries`, () => {
    // Given
    const input = { kind: "candidate-preview", previewId: uuid, projectId: head.projectId, runId: uuid,
      candidateId: uuid, candidateRevision: 4, sourceHead: head, snapshotHash: hash, entry,
      materializedScenes: script.scenes, cast: [], initialFlags: {}, assetBindings: [],
      boundaries: [{ fromSceneId: "start", targetSceneId: "future", reason: "unwritten-scene" }], includedUnitHashes: [hash] };
    // When
    const result = previewSnapshotSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
    assert.equal(releaseSnapshotSchema.safeParse(input).success, false);
  });
}
for (const approval of [{ kind: "production", digest: hash }, { kind: "manual-export", headDigest: hash }]) {
  test(`parses release ${approval.kind} when the public script and manifest are typed`, () => {
    // Given
    const input = { kind: "release", releaseId: hash, sourceHead: head, sourceScriptHash: hash,
      publicScript: script, publicScriptHash: hash, assets: [{ path: "assets/bg/title.png", hash, size: 1 }],
      approval, exporterVersion: "1", runtimeVersion: "1" };
    // When
    const result = releaseSnapshotSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
test("rejects nested unknown fields when a source script crosses the harness boundary", () => {
  // Given
  const input = { ...script, scenes: script.scenes.map(scene => ({ ...scene, hiddenReasoning: "forbidden" })) };
  // When
  const result = scriptSchema.safeParse(input);
  // Then
  assert.equal(result.success, false);
});
for (const variant of [{ state: "intent" }, { state: "dispatched" }, { state: "succeeded", artifact: { artifactId: uuid, hash, bytes: 1 }, usage: { knownInputUsage: null, knownOutputUsage: null } }, { state: "known-failed", code: "UPSTREAM" }, { state: "unknown", reason: "lost transport" }]) {
  test(`preserves effect ${variant.state} when parsing its durable record`, () => {
    // Given
    const input = { effectId: uuid, payloadHash: hash, admission, ...variant };
    // When
    const result = effectSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
