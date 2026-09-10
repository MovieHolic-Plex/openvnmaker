import assert from "node:assert/strict";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { applyCandidateTool } from "../src/operations.js";
import {
  candidateRefSchema, projectHeadSchema, runIdSchema, uuidSchema,
} from "../src/primitives.js";
import {
  reuseListEnvelopeSchema, reuseListPatchArtifactSchema,
  reuseListPatchPayloadSchema,
} from "../src/reuse-artifact-contracts.js";
import { journalFixture } from "./operations-journal-fixture.js";
import { head } from "./fixtures.js";

export async function reuseFixture() {
  const fixture = await journalFixture();
  const envelope = reuseListEnvelopeSchema.parse(fixture.envelope);
  const before = { ...fixture.input, envelope };
  const after = await applyCandidateTool(before);
  assert.equal(after.result.ok, true);
  const receipt = after.journal.calls.find(call => call.result.callId === envelope.callId);
  assert.ok(receipt);
  const originHead = projectHeadSchema.parse({
    ...head,
    scriptHash: await canonicalHash(before.candidate.script),
    productionHash: await canonicalHash(before.candidate.productionDocument),
  });
  const capture = {
    artifactId: uuidSchema.parse("00000000-0000-4000-8000-000000000041"),
    runId: runIdSchema.parse("00000000-0000-4000-8000-000000000042"),
    originHead,
    operationIds: [uuidSchema.parse("00000000-0000-4000-8000-000000000043")],
    before, after,
  };
  const snapshot = (candidate: typeof before.candidate) => ({
    script: candidate.script, productionDocument: candidate.productionDocument,
  });
  const payload = reuseListPatchPayloadSchema.parse({
    version: 1, kind: "list-patch", artifactId: capture.artifactId,
    runId: capture.runId, unitId: before.unitId, originHead,
    inputRef: before.candidate.ref, outputRef: after.candidate.ref,
    inputSnapshotHash: await canonicalHash(snapshot(before.candidate)),
    outputSnapshotHash: await canonicalHash(snapshot(after.candidate)),
    operationIds: capture.operationIds, envelope, receipt,
    allocations: after.journal.allocations,
  });
  const artifact = reuseListPatchArtifactSchema.parse({
    artifactId: capture.artifactId,
    artifactHash: await canonicalHash(payload), payload: canonicalJson(payload),
  });
  const base = {
    ...before.candidate,
    ref: candidateRefSchema.parse({
      candidateId: "00000000-0000-4000-8000-000000000044", revision: 0,
    }),
    script: {
      ...before.candidate.script,
      scenes: before.candidate.script.scenes.map(scene => scene.id === "end"
        ? { ...scene, lines: scene.lines.map(line => ({ ...line, text: "Latest source" })) }
        : scene),
    },
  };
  const newBaseHead = projectHeadSchema.parse({
    ...originHead, revision: originHead.revision + 1,
    scriptHash: await canonicalHash(base.script),
  });
  const selection = {
    artifact, expectedArtifactHash: artifact.artifactHash,
    receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000045"),
  };
  return { capture, payload, artifact, base, newBaseHead, selection };
}
