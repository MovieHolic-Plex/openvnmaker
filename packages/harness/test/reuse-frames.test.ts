import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical.js";
import { readSceneContext } from "../src/context.js";
import { candidateRefSchema, projectHeadSchema, uuidSchema } from "../src/primitives.js";
import { captureReuseContextFrame } from "../src/reuse-frames.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { reuseFixture } from "./reuse-fixture.js";

test("captures separate historical frames with ordered duplicate reader dependencies intact", async () => {
  // Given two real reader calls on opposite sides of a captured candidate transition.
  const fixture = await reuseFixture();
  const source = (candidate: typeof fixture.capture.before.candidate) => ({
    sourceHead: fixture.capture.originHead, candidateRef: candidate.ref,
    script: candidate.script, productionDocument: candidate.productionDocument,
  });
  const beforeSource = source(fixture.capture.before.candidate);
  const afterSource = source(fixture.capture.after.candidate);
  const args = toolArgumentsSchemas.read_scene.parse({ sceneId: "start", limit: 1 });
  const beforeRead = await readSceneContext(beforeSource, args);
  const afterRead = await readSceneContext(afterSource, args);
  assert.equal(beforeRead.kind, "ready");
  assert.equal(afterRead.kind, "ready");
  const repeated = beforeRead.readSet[0];
  assert.ok(repeated);
  const recordedBefore = [...beforeRead.readSet, repeated];
  const original = canonicalJson({ beforeSource, afterSource, recordedBefore });
  // When each read group is independently captured with its exact historical prefix.
  const [before, after] = await Promise.all([
    captureReuseContextFrame(beforeSource, {
      frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000301"),
      readSet: recordedBefore, precedingPatchArtifactHashes: [],
    }),
    captureReuseContextFrame(afterSource, {
      frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000302"),
      readSet: afterRead.readSet, precedingPatchArtifactHashes: [fixture.artifact.artifactHash],
    }),
  ]);
  // Then no global hash map can replace the distinct frames or deduplicate their reads.
  assert.equal(before.kind, "ready");
  assert.equal(after.kind, "ready");
  assert.deepEqual(before.frame.inputRef, fixture.capture.before.candidate.ref);
  assert.deepEqual(after.frame.inputRef, fixture.capture.after.candidate.ref);
  assert.equal(before.frame.inputSnapshotHash, fixture.payload.inputSnapshotHash);
  assert.equal(after.frame.inputSnapshotHash, fixture.payload.outputSnapshotHash);
  assert.notEqual(before.frame.inputSnapshotHash, after.frame.inputSnapshotHash);
  assert.deepEqual(before.frame.readSet, recordedBefore);
  assert.deepEqual(after.frame.readSet, afterRead.readSet);
  assert.deepEqual(before.frame.precedingPatchArtifactHashes, []);
  assert.deepEqual(after.frame.precedingPatchArtifactHashes, [fixture.artifact.artifactHash]);
  assert.deepEqual(before.frame.sourceHead, fixture.capture.originHead);
  assert.deepEqual(after.frame.sourceHead, fixture.capture.originHead);
  assert.equal(canonicalJson({ beforeSource, afterSource, recordedBefore }), original);
});

test("historical snapshot content hashes exclude head and candidate authority revisions", async () => {
  // Given identical snapshot content and recorded reads under different authority references.
  const fixture = await reuseFixture();
  const candidate = fixture.capture.before.candidate;
  const source = {
    sourceHead: fixture.capture.originHead, candidateRef: candidate.ref,
    script: candidate.script, productionDocument: candidate.productionDocument,
  };
  const revised = {
    ...source,
    sourceHead: projectHeadSchema.parse({ ...source.sourceHead, revision: source.sourceHead.revision + 1 }),
    candidateRef: candidateRefSchema.parse({ ...candidate.ref, revision: candidate.ref.revision + 1 }),
  };
  const input = {
    frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000303"),
    readSet: fixture.payload.receipt.result.readSet, precedingPatchArtifactHashes: [],
  };
  // When both historical records are captured without pretending either reference is current approval.
  const [first, second] = await Promise.all([
    captureReuseContextFrame(source, input),
    captureReuseContextFrame(revised, {
      ...input, frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000304"),
    }),
  ]);
  // Then content identity is stable while the authority provenance remains distinct and intact.
  assert.equal(first.kind, "ready");
  assert.equal(second.kind, "ready");
  assert.equal(first.frame.inputSnapshotHash, fixture.payload.inputSnapshotHash);
  assert.equal(second.frame.inputSnapshotHash, fixture.payload.inputSnapshotHash);
  assert.deepEqual(first.frame.sourceHead, source.sourceHead);
  assert.deepEqual(second.frame.sourceHead, revised.sourceHead);
  assert.deepEqual(first.frame.inputRef, source.candidateRef);
  assert.deepEqual(second.frame.inputRef, revised.candidateRef);
});
