import assert from "node:assert/strict";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { buildContextManifest, readSceneContext } from "../src/context.js";
import { artifactReceiptSchema, unitSchema } from "../src/lifecycle-contracts.js";
import { applyCandidateTool } from "../src/operations.js";
import { candidateRefSchema, projectHeadSchema, runIdSchema, uuidSchema } from "../src/primitives.js";
import {
  reuseListEnvelopeSchema, reuseListPatchArtifactSchema, reuseListPatchPayloadSchema,
} from "../src/reuse-artifact-contracts.js";
import { captureReuseListPatch } from "../src/reuse-capture.js";
import type { ClassifyReuseListUnitInput } from "../src/reuse-classify.js";
import { captureReuseContextFrame } from "../src/reuse-frames.js";
import { reuseListUnitEvidenceSchema } from "../src/reuse-unit-evidence.js";
import { scriptSchema } from "../src/script-contracts.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { head } from "./fixtures.js";
import { journalFixture } from "./operations-journal-fixture.js";

export async function sameSceneReuseFixture(mode: "current" | "legacy") {
  const fixture = await journalFixture();
  const originalBase = { ...fixture.input.candidate, script: scriptSchema.parse({
    ...fixture.input.candidate.script,
    scenes: fixture.input.candidate.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: [...scene.lines, { id: "l-b", speaker: null, text: "Unreturned original", shake: true }],
    } : scene),
  }) };
  const scene = originalBase.script.scenes.find(value => value.id === "start");
  assert.ok(scene);
  const target = scene.lines[0];
  assert.ok(target);
  const intermediateText = "Intermediate candidate";
  const finalText = "Final preserved candidate";
  const manualText = "Latest unreturned source edit";
  const initialHash = await canonicalHash(target);
  const intermediateHash = await canonicalHash({ ...target, text: intermediateText });
  const envelope = reuseListEnvelopeSchema.parse({
    ...fixture.envelope, tool: "patch_lines", arguments: { sceneId: "start", operations: [
      { kind: "update", lineId: target.id, expectedEntityHash: initialHash,
        patch: { set: { text: intermediateText }, unset: [] } },
      { kind: "update", lineId: target.id, expectedEntityHash: intermediateHash,
        patch: { set: { text: finalText }, unset: [] } },
    ] },
  });
  const before = { ...fixture.input, candidate: originalBase, envelope };
  const after = await applyCandidateTool(before);
  assert.equal(after.result.ok, true);
  const sourceHead = projectHeadSchema.parse({ ...head,
    scriptHash: await canonicalHash(originalBase.script), productionHash: await canonicalHash(originalBase.productionDocument),
  });
  const captured = await captureReuseListPatch({
    artifactId: uuidSchema.parse("00000000-0000-4000-8000-000000000701"),
    runId: runIdSchema.parse("00000000-0000-4000-8000-000000000702"), originHead: sourceHead,
    operationIds: ["00000000-0000-4000-8000-000000000703", "00000000-0000-4000-8000-000000000704"],
    before, after,
  });
  assert.equal(captured.kind, "ready");
  const decoded: unknown = JSON.parse(captured.artifact.payload);
  const currentPayload = reuseListPatchPayloadSchema.parse(decoded);
  // Explicit retained legacy wire evidence, not re-captured under the narrowed producer.
  const payload = mode === "current" ? currentPayload : reuseListPatchPayloadSchema.parse({
    ...currentPayload, receipt: { ...currentPayload.receipt, result: {
      ...currentPayload.receipt.result,
      readSet: [{ kind: "entity", target: { kind: "scene", sceneId: "start" }, hash: await canonicalHash(scene) }],
    } },
  });
  const artifact = reuseListPatchArtifactSchema.parse({
    artifactId: payload.artifactId, artifactHash: await canonicalHash(payload), payload: canonicalJson(payload),
  });
  const source = (candidate: typeof originalBase) => ({
    sourceHead, candidateRef: candidate.ref, script: candidate.script, productionDocument: candidate.productionDocument,
  });
  const args = toolArgumentsSchemas.read_scene.parse({ sceneId: "start", limit: 1 });
  const firstRead = await readSceneContext(source(originalBase), args);
  const finalRead = await readSceneContext(source(after.candidate), args);
  assert.equal(firstRead.kind, "ready");
  assert.equal(finalRead.kind, "ready");
  const firstFrame = await captureReuseContextFrame(source(originalBase), {
    frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000705"),
    precedingPatchArtifactHashes: [], readSet: [...firstRead.readSet, ...payload.receipt.result.readSet],
  });
  const finalFrame = await captureReuseContextFrame(source(after.candidate), {
    frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000706"),
    precedingPatchArtifactHashes: [artifact.artifactHash], readSet: finalRead.readSet,
  });
  const frames = [firstFrame.frame, finalFrame.frame];
  const manifest = await buildContextManifest({
    sourceHead, windows: [firstRead.window, finalRead.window], facts: [],
    readSet: frames.flatMap(frame => frame.readSet), referenceBindingHashes: [],
    excluded: [...firstRead.excluded, ...finalRead.excluded],
  });
  assert.equal(manifest.kind, "ready");
  const modelBinding = { modelId: "fixture-model", config: { temperature: 0.5 } };
  const unit = unitSchema.parse({
    id: before.unitId, kind: "scene-draft", status: "ready", dependencyHashes: [], autoRepairRound: 0,
    contextManifest: manifest.manifest, provenance: {
      originHead: sourceHead, inputContentHash: manifest.manifest.inputContentHash,
      readSet: manifest.manifest.readSet, writeSet: payload.receipt.result.writeSet,
      outputArtifactHash: artifact.artifactHash, modelBindingHash: await canonicalHash(modelBinding),
      referenceBindingHashes: [], validatedForHead: sourceHead,
    },
  });
  const evidence = reuseListUnitEvidenceSchema.parse({
    version: 1, unitHash: await canonicalHash(unit), modelBinding,
    originalBase: { sourceHead, inputRef: originalBase.ref, inputSnapshotHash: payload.inputSnapshotHash },
    frames, patchArtifactHashes: [artifact.artifactHash], outputPatchArtifactHashes: [artifact.artifactHash],
  });
  const currentBase = { ...originalBase,
    ref: candidateRefSchema.parse({ candidateId: "00000000-0000-4000-8000-000000000707", revision: 0 }),
    script: scriptSchema.parse({ ...originalBase.script, scenes: originalBase.script.scenes.map(row => row.id === "start" ? {
      ...row, lines: row.lines.map(line => line.id === "l-b" ? { ...line, text: manualText } : line),
    } : row) }),
  };
  const bytes = new TextEncoder().encode(artifact.payload);
  const input: ClassifyReuseListUnitInput = {
    unit, evidence, expectedEvidenceHash: await canonicalHash(evidence), originalBase, currentBase,
    newBaseHead: projectHeadSchema.parse({ ...sourceHead, revision: sourceHead.revision + 1,
      scriptHash: await canonicalHash(currentBase.script) }),
    output: { kind: "present", output: { bytes, receipt: artifactReceiptSchema.parse({
      artifactId: artifact.artifactId, hash: artifact.artifactHash, bytes: bytes.byteLength,
    }) } },
    patches: [{ artifact, expectedArtifactHash: artifact.artifactHash,
      receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000708") }],
  };
  return { input, payload, target, initialHash, intermediateHash, finalText, manualText, firstRead };
}
