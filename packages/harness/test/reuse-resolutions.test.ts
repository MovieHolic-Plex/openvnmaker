import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { hashSchema, projectHeadSchema } from "../src/primitives.js";
import { resolutionSchema } from "../src/reuse-contracts.js";
import { assembleResolvedReuseListPatches } from "../src/reuse-resolutions.js";
import { reuseFixture } from "./reuse-fixture.js";
import { resolutionUpdateFixture } from "./reuse-resolution-fixture.js";

test("keep-source omits the named operation without claiming its output was reused", async () => {
  // Given a preserved insertion and an explicit decision to retain the source instead.
  const fixture = await reuseFixture();
  const original = canonicalJson(fixture.base);
  const resolution = resolutionSchema.parse({
    kind: "keep-source", operationIds: fixture.capture.operationIds,
  });
  // When the selected result is explicitly omitted.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then the source snapshot remains the complete candidate, without a reuse receipt.
  assert.equal(result.kind, "ready");
  assert.equal(canonicalJson(result.candidate), original);
  assert.deepEqual(result.receipts, []);
  assert.deepEqual(result.allocations, []);
  assert.deepEqual(result.repairUnitIds, []);
  hashSchema.parse(result.resolutionDigest);
  assert.equal(canonicalJson(fixture.base), original);
});

test("use-candidate-fields applies only explicitly selected fields at the current entity hash", async () => {
  // Given an old update and a concurrently changed target with other candidate fields unselected.
  const fixture = await resolutionUpdateFixture();
  const originalArtifact = canonicalJson(fixture.selection.artifact);
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.operationId,
    target: { kind: "line", sceneId: "start", lineId: "l-a" },
    expectedCurrentEntityHash: fixture.currentEntityHash, fields: ["text"],
  });
  // When the author explicitly chooses the candidate text only.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then source shake/when survive, while the historical artifact bytes stay immutable.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start")?.lines, [
    { ...fixture.currentLine, text: fixture.proposedText },
  ]);
  assert.equal(result.candidate.ref.revision, 1);
  assert.deepEqual(result.receipts.map(receipt => receipt.reusedFrom.artifactHash), [
    fixture.selection.expectedArtifactHash,
  ]);
  assert.deepEqual(result.repairUnitIds, []);
  assert.equal(canonicalJson(fixture.selection.artifact), originalArtifact);
});

test("insert-as-new copies preserved inserted bytes only at the explicitly selected new gap", async () => {
  // Given the original generated ID already exists in the source at its original location.
  const fixture = await reuseFixture();
  const script = fixture.capture.after.candidate.script;
  const oldLine = script.scenes.find(scene => scene.id === "start")?.lines[1];
  assert.ok(oldLine);
  const { id: oldId, ...retainedValue } = oldLine;
  assert.ok(oldId);
  const base = { ...fixture.base, script };
  const original = canonicalJson(base);
  const newBaseHead = projectHeadSchema.parse({
    ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
  });
  const resolution = resolutionSchema.parse({
    kind: "insert-as-new", sourceArtifactId: fixture.artifact.artifactId,
    sceneId: "end", gap: { leftId: "l-a", rightId: null }, clientKey: "explicit-copy",
  });
  // When the author explicitly copies that artifact into another scoped position.
  const result = await assembleResolvedReuseListPatches({
    base, newBaseHead, patches: [fixture.selection], resolutions: [resolution],
  });
  // Then the occupied original remains and only the explicit copy receives a fresh ID.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start"),
    script.scenes.find(scene => scene.id === "start"));
  const copied = result.candidate.script.scenes.find(scene => scene.id === "end")?.lines[1];
  assert.ok(copied);
  const { id: copiedId, ...copiedValue } = copied;
  assert.ok(copiedId);
  assert.notEqual(copiedId, oldId);
  assert.deepEqual(copiedValue, retainedValue);
  assert.equal(result.allocations.length, 1);
  const allocation = result.allocations[0];
  assert.ok(allocation);
  assert.deepEqual(allocation.target, { kind: "line", sceneId: "end", lineId: copiedId });
  assert.equal(canonicalJson(base), original);
});

test("regenerate-unit returns repair requirements without retaining its patch or dispatching work", async () => {
  // Given a successful unit explicitly selected for repair instead of reuse.
  const fixture = await reuseFixture();
  const resolution = resolutionSchema.parse({
    kind: "regenerate-unit", unitId: fixture.capture.before.unitId, issueIds: [],
  });
  // When its resolution is assembled through the pure candidate seam.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then only a repair requirement is returned; candidate bytes and receipts remain untouched.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate, fixture.base);
  assert.deepEqual(result.receipts, []);
  assert.deepEqual(result.allocations, []);
  assert.deepEqual(result.repairUnitIds, [fixture.capture.before.unitId]);
});

test("explicit candidate fields still reject a stale expectedCurrentEntityHash", async () => {
  // Given an author resolution bound to the obsolete target value.
  const fixture = await resolutionUpdateFixture();
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.operationId,
    target: { kind: "line", sceneId: "start", lineId: "l-a" },
    expectedCurrentEntityHash: fixture.originalEntityHash, fields: ["text"],
  });
  // When the source entity no longer matches that explicit precondition.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then the library cannot silently refresh even the resolution's own hash.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
});

test("rejects conflicting resolutions for the same original operation", async () => {
  // Given opposite decisions naming one operation rather than two independent targets.
  const fixture = await resolutionUpdateFixture();
  const resolutions = [
    resolutionSchema.parse({ kind: "keep-source", operationIds: [fixture.operationId] }),
    resolutionSchema.parse({
      kind: "use-candidate-fields", operationId: fixture.operationId,
      target: { kind: "line", sceneId: "start", lineId: "l-a" },
      expectedCurrentEntityHash: fixture.currentEntityHash, fields: ["text"],
    }),
  ];
  // When those conflicting decisions are submitted together.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions,
  });
  // Then array order does not silently decide which author instruction wins.
  assert.deepEqual(result, { kind: "blocked", reason: "INVALID_INPUT" });
});
