import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { applyCandidateTool } from "../src/operations.js";
import { uuidSchema } from "../src/primitives.js";
import { reuseListEnvelopeSchema } from "../src/reuse-artifact-contracts.js";
import { captureReuseListPatch } from "../src/reuse-capture.js";
import { resolutionSchema } from "../src/reuse-contracts.js";
import { assembleResolvedReuseListPatches } from "../src/reuse-resolutions.js";
import { reuseFixture } from "./reuse-fixture.js";
import { resolutionUpdateFixture } from "./reuse-resolution-fixture.js";

async function mixedBatchFixture() {
  const fixture = await reuseFixture();
  const line = fixture.capture.before.candidate.script.scenes.find(scene => scene.id === "start")?.lines[0];
  assert.ok(line);
  const text = "Preserved first operation";
  const envelope = reuseListEnvelopeSchema.parse({
    ...fixture.capture.before.envelope, arguments: {
      sceneId: "start", operations: [{
        kind: "update", lineId: line.id, expectedEntityHash: await canonicalHash(line),
        patch: { set: { text }, unset: [] },
      }, ...fixture.capture.before.envelope.arguments.operations],
    },
  });
  const before = { ...fixture.capture.before, envelope };
  const after = await applyCandidateTool(before);
  assert.equal(after.result.ok, true);
  const insertedOperationId = uuidSchema.parse("00000000-0000-4000-8000-000000000102");
  const captured = await captureReuseListPatch({
    ...fixture.capture, before, after,
    operationIds: [uuidSchema.parse("00000000-0000-4000-8000-000000000101"), insertedOperationId],
  });
  assert.equal(captured.kind, "ready");
  return {
    ...fixture, line, text, insertedOperationId,
    selection: { ...fixture.selection, artifact: captured.artifact,
      expectedArtifactHash: captured.artifact.artifactHash },
  };
}

test("explicit unset affects only the selected originally proposed optional field", async () => {
  // Given the candidate proposed a when removal plus other unselected changes.
  const fixture = await resolutionUpdateFixture();
  const { when: _removed, ...expected } = fixture.currentLine;
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.operationId,
    target: { kind: "line", sceneId: "start", lineId: "l-a" },
    expectedCurrentEntityHash: fixture.currentEntityHash, fields: ["when"],
  });
  // When only the optional field removal is selected.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then candidate text/shake are not imported as collateral writes.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start")?.lines, [expected]);
});

test("candidate field selection cannot expand beyond the original proposed fields", async () => {
  // Given a valid runtime field that was never included in the original patch.
  const fixture = await resolutionUpdateFixture();
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.operationId,
    target: { kind: "line", sceneId: "start", lineId: "l-a" },
    expectedCurrentEntityHash: fixture.currentEntityHash, fields: ["speaker"],
  });
  // When it is selected as though it were generated candidate output.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then resolution is not a new unrestricted editing tool.
  assert.deepEqual(result, { kind: "blocked", reason: "WRITE_SCOPE_DENIED" });
});

test("candidate fields cannot retarget a same-ID line in another scene even with its valid hash", async () => {
  // Given the other scene has a real same-ID target and its own correct current hash.
  const fixture = await resolutionUpdateFixture();
  const other = fixture.base.script.scenes.find(scene => scene.id === "end")?.lines[0];
  assert.ok(other);
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.operationId,
    target: { kind: "line", sceneId: "end", lineId: "l-a" },
    expectedCurrentEntityHash: await canonicalHash(other), fields: ["text"],
  });
  // When a resolution tries to substitute that target for the originally scoped one.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then exact target identity wins over a valid hash at an unauthorized position.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
});

test("insert-as-new reports an update artifact without complete insertion bytes as unsupported", async () => {
  // Given an update-only artifact, not a complete newly inserted entity.
  const fixture = await resolutionUpdateFixture();
  const resolution = resolutionSchema.parse({
    kind: "insert-as-new", sourceArtifactId: fixture.selection.artifact.artifactId,
    sceneId: "end", gap: { leftId: "l-a", rightId: null }, clientKey: "copy-update",
  });
  // When the caller asks to create a complete new entity from partial update fields.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then the library cannot invent missing entity content from the latest source.
  assert.deepEqual(result, { kind: "blocked", reason: "UNSUPPORTED_RESOLUTION" });
});

test("insert-as-new never chooses arbitrary insertion content from a mixed batch", async () => {
  // Given one artifact includes an update followed by an insertion.
  const fixture = await mixedBatchFixture();
  const resolution = resolutionSchema.parse({
    kind: "insert-as-new", sourceArtifactId: fixture.selection.artifact.artifactId,
    sceneId: "end", gap: { leftId: "l-a", rightId: null }, clientKey: "ambiguous-copy",
  });
  // When only the artifact, not a dedicated insertion payload, is selected for copying.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then selecting its first or last inserted element would be an invented resolution.
  assert.deepEqual(result, { kind: "blocked", reason: "UNSUPPORTED_RESOLUTION" });
});

test("keep-source can omit one operation while atomically preserving the rest of its batch", async () => {
  // Given an update and insertion share one original successful call.
  const fixture = await mixedBatchFixture();
  const original = canonicalJson(fixture.selection.artifact);
  const resolution = resolutionSchema.parse({
    kind: "keep-source", operationIds: [fixture.insertedOperationId],
  });
  // When only the insertion is explicitly omitted.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then the remaining operation is applied, not silently omitted or widened to the whole batch.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start")?.lines, [
    { ...fixture.line, text: fixture.text },
  ]);
  assert.deepEqual(result.allocations, []);
  assert.equal(result.receipts.length, 1);
  assert.equal(canonicalJson(fixture.selection.artifact), original);
});

test("rejects an omission naming an operation absent from the retained evidence", async () => {
  // Given an otherwise valid selection and an unrelated operation identity.
  const fixture = await reuseFixture();
  const resolution = resolutionSchema.parse({
    kind: "keep-source", operationIds: ["00000000-0000-4000-8000-000000000199"],
  });
  // When that unknown operation is submitted as a resolution.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection], resolutions: [resolution],
  });
  // Then the request cannot disappear as an ignored no-op.
  assert.deepEqual(result, { kind: "blocked", reason: "INVALID_INPUT" });
});
