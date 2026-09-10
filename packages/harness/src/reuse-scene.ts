import type { ReuseListCaptureInput } from "./reuse-capture.js";
import type { ReuseListAssemblyInput, ReuseListAssemblyResult } from "./reuse-assembly.js";
import type { ClassifyReuseListUnitInput, ClassifyReuseListUnitResult } from "./reuse-classify.js";
import type { ReuseSceneMetadataArtifact } from "./reuse-scene-contracts.js";
import { reuseSceneMetadataEnvelopeSchema, reuseSceneMetadataPayloadSchema } from "./reuse-scene-contracts.js";
import { captureReusePatch } from "./reuse-capture.js";
import { assembleReusePatches } from "./reuse-assembly.js";
import { classifyReuseUnit } from "./reuse-classify.js";
import { reuseSceneMetadataFamily } from "./reuse-scene-family.js";

export type ReuseSceneMetadataCaptureResult =
  | { readonly kind: "ready"; readonly artifact: ReuseSceneMetadataArtifact }
  | { readonly kind: "blocked"; readonly reason: "EVIDENCE_MISMATCH" | "UNSUPPORTED_PATCH" };
export type ReuseSceneMetadataAssemblyResult = ReuseListAssemblyResult;
export type ReuseSceneMetadataClassificationResult = ClassifyReuseListUnitResult;

export async function captureReuseSceneMetadataPatch(
  input: ReuseListCaptureInput,
): Promise<ReuseSceneMetadataCaptureResult> {
  return captureReusePatch(input, {
    kind: "scene-metadata-patch", envelope: reuseSceneMetadataEnvelopeSchema,
    payload: reuseSceneMetadataPayloadSchema, operationCount: () => 1,
  });
}

/** Current candidate assembly uses original scene ID/hash/fields, never the old whole candidate. */
export async function assembleReuseSceneMetadataPatches(
  input: ReuseListAssemblyInput,
): Promise<ReuseSceneMetadataAssemblyResult> {
  return assembleReusePatches(input, reuseSceneMetadataFamily);
}

/** Direct recorded-evidence classification; not image approval or source-apply authority. */
export async function classifyReuseSceneMetadataUnit(
  input: ClassifyReuseListUnitInput,
): Promise<ReuseSceneMetadataClassificationResult> {
  return classifyReuseUnit(input, reuseSceneMetadataFamily);
}
