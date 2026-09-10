import assert from "node:assert/strict";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { buildContextManifest, readSceneContext } from "../src/context.js";
import { artifactReceiptSchema, unitSchema } from "../src/lifecycle-contracts.js";
import { applyCandidateTool } from "../src/operations.js";
import { candidateRefSchema, projectHeadSchema, runIdSchema, uuidSchema } from "../src/primitives.js";
import { captureReuseContextFrame } from "../src/reuse-frames.js";
import {
  reuseSceneMetadataArtifactSchema, reuseSceneMetadataEnvelopeSchema, reuseSceneMetadataPayloadSchema,
} from "../src/reuse-scene-contracts.js";
import { reuseListUnitEvidenceSchema } from "../src/reuse-unit-evidence.js";
import { writeSetSchema } from "../src/context-contracts.js";
import { scriptSchema } from "../src/script-contracts.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import type { ClassifyReuseListUnitInput } from "../src/reuse-classify.js";
import { head } from "./fixtures.js";
import { projectFixture } from "./operations-project-fixture.js";

export async function sceneMetadataReuseFixture() {
  const fixture = await projectFixture();
  const originalBase = fixture.input.candidate;
  const target = originalBase.script.scenes.find(scene => scene.id === "start");
  assert.ok(target);
  const expectedSceneHash = await canonicalHash(target);
  const backgroundUrl = "/assets/retained-background.png";
  const patch = { set: { backgroundUrl, artBrief: "Preserved background direction" }, unset: [] };
  const envelope = reuseSceneMetadataEnvelopeSchema.parse({
    ...fixture.common, tool: "set_scene", arguments: { sceneId: "start", expectedSceneHash, patch },
  });
  const before = { ...fixture.input, envelope, authorizedWriteSet: writeSetSchema.parse([{
    target: { kind: "scene", sceneId: "start" }, fields: ["backgroundUrl", "artBrief"],
  }]) };
  const after = await applyCandidateTool(before);
  assert.equal(after.result.ok, true);
  const receipt = after.journal.calls.find(call => call.result.callId === envelope.callId);
  assert.ok(receipt);
  const originHead = projectHeadSchema.parse({ ...head,
    scriptHash: await canonicalHash(originalBase.script), productionHash: await canonicalHash(originalBase.productionDocument),
  });
  const capture = {
    artifactId: uuidSchema.parse("00000000-0000-4000-8000-000000000801"),
    runId: runIdSchema.parse("00000000-0000-4000-8000-000000000802"), originHead,
    operationIds: [uuidSchema.parse("00000000-0000-4000-8000-000000000803")], before, after,
  };
  const payload = reuseSceneMetadataPayloadSchema.parse({
    version: 1, kind: "scene-metadata-patch", artifactId: capture.artifactId,
    runId: capture.runId, unitId: before.unitId, originHead,
    inputRef: originalBase.ref, outputRef: after.candidate.ref,
    inputSnapshotHash: await canonicalHash({ script: originalBase.script, productionDocument: originalBase.productionDocument }),
    outputSnapshotHash: await canonicalHash({ script: after.candidate.script, productionDocument: after.candidate.productionDocument }),
    operationIds: capture.operationIds, envelope, receipt, allocations: after.journal.allocations,
  });
  const artifact = reuseSceneMetadataArtifactSchema.parse({
    artifactId: capture.artifactId, artifactHash: await canonicalHash(payload), payload: canonicalJson(payload),
  });
  const source = { sourceHead: originHead, candidateRef: originalBase.ref,
    script: originalBase.script, productionDocument: originalBase.productionDocument };
  const read = await readSceneContext(source, toolArgumentsSchemas.read_scene.parse({ sceneId: "start", limit: 1 }));
  assert.equal(read.kind, "ready");
  const frame = await captureReuseContextFrame(source, {
    frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000804"),
    precedingPatchArtifactHashes: [], readSet: [...read.readSet, ...payload.receipt.result.readSet],
  });
  const manifest = await buildContextManifest({
    sourceHead: originHead, windows: [read.window], facts: [], readSet: frame.frame.readSet,
    referenceBindingHashes: [], excluded: read.excluded,
  });
  assert.equal(manifest.kind, "ready");
  const modelBinding = { modelId: "fixture-model", config: { temperature: 0.5 } };
  const unit = unitSchema.parse({
    id: before.unitId, kind: "scene-repair", status: "ready", dependencyHashes: [], autoRepairRound: 0,
    contextManifest: manifest.manifest, provenance: {
      originHead, inputContentHash: manifest.manifest.inputContentHash, readSet: manifest.manifest.readSet,
      writeSet: after.result.writeSet, outputArtifactHash: artifact.artifactHash,
      modelBindingHash: await canonicalHash(modelBinding), referenceBindingHashes: [], validatedForHead: originHead,
    },
  });
  const evidence = reuseListUnitEvidenceSchema.parse({
    version: 1, unitHash: await canonicalHash(unit), modelBinding,
    originalBase: { sourceHead: originHead, inputRef: originalBase.ref, inputSnapshotHash: payload.inputSnapshotHash },
    frames: [frame.frame], patchArtifactHashes: [artifact.artifactHash], outputPatchArtifactHashes: [artifact.artifactHash],
  });
  const currentBase = { ...originalBase,
    ref: candidateRefSchema.parse({ candidateId: "00000000-0000-4000-8000-000000000805", revision: 0 }),
    script: scriptSchema.parse({ ...originalBase.script,
      scenes: originalBase.script.scenes.map(scene => scene.id === "end" ? {
        ...scene, lines: scene.lines.map(line => ({ ...line, text: "Latest other-chapter source edit" })),
      } : scene),
    }),
  };
  const newBaseHead = projectHeadSchema.parse({ ...originHead, revision: originHead.revision + 1,
    scriptHash: await canonicalHash(currentBase.script) });
  const bytes = new TextEncoder().encode(artifact.payload);
  const input: ClassifyReuseListUnitInput = {
    unit, evidence, expectedEvidenceHash: await canonicalHash(evidence), originalBase, currentBase, newBaseHead,
    output: { kind: "present", output: { bytes, receipt: artifactReceiptSchema.parse({
      artifactId: artifact.artifactId, hash: artifact.artifactHash, bytes: bytes.byteLength,
    }) } },
    patches: [{ artifact, expectedArtifactHash: artifact.artifactHash,
      receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000806") }],
  };
  return { input, capture, payload, artifact, target, patch, backgroundUrl, expectedSceneHash };
}
