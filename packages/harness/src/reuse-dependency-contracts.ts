import { z } from "zod";
import { readSetSchema } from "./context-contracts.js";
import {
  candidateRefSchema, hashSchema, projectHeadSchema, unitIdSchema, uuidSchema,
} from "./primitives.js";
import { reuseAnalysisSchema } from "./reuse-contracts.js";

/** Historical preimage binding, not a semantic read dependency or inputContentHash. */
export const reuseContextFrameSchema = z.strictObject({
  version: z.literal(1), frameId: uuidSchema, sourceHead: projectHeadSchema,
  inputRef: candidateRefSchema, inputSnapshotHash: hashSchema,
  precedingPatchArtifactHashes: z.array(hashSchema).readonly(),
  readSet: readSetSchema,
}).readonly();

export const reuseUnitDependencySchema = z.strictObject({
  unitId: unitIdSchema, expectedOutputArtifactHash: hashSchema,
}).readonly();

/** Direct results are supplied by evidence/frame validation, never author approval. */
export const reuseDependencyUnitSchema = z.strictObject({
  result: reuseAnalysisSchema.unwrap().shape.units.unwrap().element,
  outputArtifactHash: hashSchema.nullable(),
  dependencies: z.array(reuseUnitDependencySchema).readonly(),
}).readonly();

export type ReuseContextFrame = z.infer<typeof reuseContextFrameSchema>;
export type ReuseUnitDependency = z.infer<typeof reuseUnitDependencySchema>;
export type ReuseDependencyUnit = z.infer<typeof reuseDependencyUnitSchema>;
