import assert from "node:assert/strict";
import { buildContextManifest } from "../src/context.js";
import { artifactReceiptSchema, unitSchema } from "../src/lifecycle-contracts.js";
import { hashSchema, uuidSchema } from "../src/primitives.js";
import { captureReuseContextFrame } from "../src/reuse-frames.js";
import { reuseFixture } from "./reuse-fixture.js";

export async function outputVerificationFixture() {
  const fixture = await reuseFixture();
  const context = await buildContextManifest({
    sourceHead: fixture.capture.originHead, windows: [], facts: [],
    readSet: fixture.payload.receipt.result.readSet,
    referenceBindingHashes: [], excluded: [],
  });
  assert.equal(context.kind, "ready");
  const unit = unitSchema.parse({
    id: fixture.capture.before.unitId, kind: "scene-draft", status: "ready",
    dependencyHashes: [], autoRepairRound: 0, contextManifest: context.manifest,
    provenance: {
      originHead: fixture.capture.originHead,
      inputContentHash: context.manifest.inputContentHash,
      readSet: context.manifest.readSet, writeSet: fixture.payload.receipt.result.writeSet,
      outputArtifactHash: fixture.artifact.artifactHash,
      modelBindingHash: hashSchema.parse("c".repeat(64)), referenceBindingHashes: [],
      validatedForHead: fixture.capture.originHead,
    },
  });
  assert.equal(unit.status, "ready");
  const candidate = fixture.capture.before.candidate;
  const captured = await captureReuseContextFrame({
    sourceHead: fixture.capture.originHead, candidateRef: candidate.ref,
    script: candidate.script, productionDocument: candidate.productionDocument,
  }, {
    frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000501"),
    precedingPatchArtifactHashes: [], readSet: context.manifest.readSet,
  });
  const bytes = new TextEncoder().encode(fixture.artifact.payload);
  const receipt = artifactReceiptSchema.parse({
    artifactId: fixture.artifact.artifactId, hash: fixture.artifact.artifactHash,
    bytes: bytes.byteLength,
  });
  return { unit, frame: captured.frame, output: { receipt, bytes } };
}
