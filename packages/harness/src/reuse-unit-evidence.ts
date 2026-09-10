import { z } from "zod";
import { candidateRefSchema, hashSchema, projectHeadSchema } from "./primitives.js";
import { reuseContextFrameSchema } from "./reuse-dependency-contracts.js";

/** Immutable sidecar evidence; its expected hash comes from the source run/snapshot. */
export const reuseListUnitEvidenceSchema = z.strictObject({
  version: z.literal(1), unitHash: hashSchema,
  /** Credential-free source model/config descriptor; absence is not proof of completeness. */
  modelBinding: z.json().optional(),
  originalBase: z.strictObject({
    sourceHead: projectHeadSchema, inputRef: candidateRefSchema, inputSnapshotHash: hashSchema,
  }).readonly(),
  frames: z.array(reuseContextFrameSchema).readonly(),
  patchArtifactHashes: z.array(hashSchema).readonly(),
  outputPatchArtifactHashes: z.array(hashSchema).readonly(),
}).readonly();
export type ReuseListUnitEvidence = z.infer<typeof reuseListUnitEvidenceSchema>;
