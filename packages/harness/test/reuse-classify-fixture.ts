import assert from "node:assert/strict";
import { canonicalHash } from "../src/canonical.js";
import { buildContextManifest, readSceneContext } from "../src/context.js";
import type { ReadSet } from "../src/context-contracts.js";
import { artifactReceiptSchema, unitSchema } from "../src/lifecycle-contracts.js";
import { inspectionBindingCatalogDependency } from "../src/operations-inspect.js";
import { inspectionOverviewProjection, inspectionOverviewRecipeSchema } from "../src/operations-inspect-overview.js";
import { uuidSchema } from "../src/primitives.js";
import { captureReuseContextFrame } from "../src/reuse-frames.js";
import { reuseListUnitEvidenceSchema } from "../src/reuse-unit-evidence.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import type { ClassifyReuseListUnitInput } from "../src/reuse-classify.js";
import { reuseFixture } from "./reuse-fixture.js";

export async function classifyFixture(extra: ReadSet = []): Promise<ClassifyReuseListUnitInput> {
  const fixture = await reuseFixture();
  const originalBase = fixture.capture.before.candidate;
  const source = (candidate: typeof originalBase) => ({
    sourceHead: fixture.capture.originHead, candidateRef: candidate.ref,
    script: candidate.script, productionDocument: candidate.productionDocument,
  });
  const args = toolArgumentsSchemas.read_scene.parse({ sceneId: "start", limit: 100 });
  const before = await readSceneContext(source(originalBase), args);
  const after = await readSceneContext(source(fixture.capture.after.candidate), args);
  assert.equal(before.kind, "ready");
  assert.equal(after.kind, "ready");
  const overview = await inspectionOverviewProjection(originalBase, inspectionOverviewRecipeSchema.parse({
    kind: "inspection-project-overview", version: 1, offset: 0, limit: 1,
  }));
  const inspection = [await inspectionBindingCatalogDependency(originalBase.productionDocument), overview.dependency];
  const firstRead = before.readSet[0];
  assert.ok(firstRead);
  const beforeReads = [...before.readSet, firstRead, ...fixture.payload.receipt.result.readSet, ...inspection, ...extra];
  const beforeFrame = await captureReuseContextFrame(source(originalBase), {
    frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000601"),
    readSet: beforeReads, precedingPatchArtifactHashes: [],
  });
  const afterFrame = await captureReuseContextFrame(source(fixture.capture.after.candidate), {
    frameId: uuidSchema.parse("00000000-0000-4000-8000-000000000602"),
    readSet: after.readSet, precedingPatchArtifactHashes: [fixture.artifact.artifactHash],
  });
  // Aggregation binds recorded unit input bytes only; replay must remain per frame.
  const manifest = await buildContextManifest({
    sourceHead: fixture.capture.originHead, windows: [before.window, after.window], facts: [],
    readSet: [...beforeReads, ...after.readSet], referenceBindingHashes: [],
    excluded: [...before.excluded, ...after.excluded],
  });
  assert.equal(manifest.kind, "ready");
  const modelBinding = { modelId: "fixture-model", config: { temperature: 0.5 } };
  const unit = unitSchema.parse({
    id: fixture.capture.before.unitId, kind: "scene-draft", status: "ready",
    dependencyHashes: [], autoRepairRound: 0, contextManifest: manifest.manifest,
    provenance: {
      originHead: fixture.capture.originHead, inputContentHash: manifest.manifest.inputContentHash,
      readSet: manifest.manifest.readSet, writeSet: fixture.payload.receipt.result.writeSet,
      outputArtifactHash: fixture.artifact.artifactHash, modelBindingHash: await canonicalHash(modelBinding),
      referenceBindingHashes: [], validatedForHead: fixture.capture.originHead,
    },
  });
  const evidence = reuseListUnitEvidenceSchema.parse({
    version: 1, unitHash: await canonicalHash(unit), modelBinding,
    originalBase: { sourceHead: fixture.capture.originHead, inputRef: originalBase.ref,
      inputSnapshotHash: fixture.payload.inputSnapshotHash },
    frames: [beforeFrame.frame, afterFrame.frame],
    patchArtifactHashes: [fixture.artifact.artifactHash], outputPatchArtifactHashes: [fixture.artifact.artifactHash],
  });
  const bytes = new TextEncoder().encode(fixture.artifact.payload);
  return {
    unit, evidence, expectedEvidenceHash: await canonicalHash(evidence),
    originalBase, currentBase: fixture.base, newBaseHead: fixture.newBaseHead,
    output: { kind: "present", output: {
      bytes, receipt: artifactReceiptSchema.parse({
        artifactId: fixture.artifact.artifactId, hash: fixture.artifact.artifactHash, bytes: bytes.byteLength,
      }),
    } },
    patches: [fixture.selection],
  };
}
