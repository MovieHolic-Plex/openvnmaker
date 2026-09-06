import { z } from "zod";
import { gapSchema, hashSchema, identifierSchema, projectHeadSchema, runIdSchema, sceneIdSchema, unitIdSchema, uuidSchema } from "./primitives.js";
import { readSetSchema, targetSchema, writeSetSchema } from "./context-contracts.js";

export const reuseClassificationSchema = z.enum(["eligible", "needs-review", "conflict", "unavailable"]);
export const unitProvenanceSchema = z.strictObject({
  originHead: projectHeadSchema, inputContentHash: hashSchema, readSet: readSetSchema, writeSet: writeSetSchema,
  outputArtifactHash: hashSchema, modelBindingHash: hashSchema, referenceBindingHashes: z.array(hashSchema).readonly(),
  validatedForHead: projectHeadSchema.optional(),
  reusedFrom: z.strictObject({ runId: runIdSchema, unitId: unitIdSchema, artifactHash: hashSchema, originHead: projectHeadSchema }).readonly().optional(),
}).readonly();
export const reuseAnalysisSchema = z.strictObject({
  analysisId: uuidSchema, analysisDigest: hashSchema, sourceDigest: hashSchema, newBaseHead: projectHeadSchema,
  units: z.array(z.strictObject({ unitId: unitIdSchema, classification: reuseClassificationSchema,
    reasons: z.array(identifierSchema).readonly(), changedDependencies: readSetSchema }).readonly()).readonly(),
  assets: z.array(z.strictObject({ assetId: identifierSchema, classification: reuseClassificationSchema,
    reasons: z.array(identifierSchema).readonly() }).readonly()).readonly(),
  requiredReviews: z.array(unitIdSchema).readonly(), requiredRepairs: z.array(unitIdSchema).readonly(),
}).readonly();
export const resolutionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("keep-source"), operationIds: z.array(uuidSchema).min(1).readonly() }),
  z.strictObject({ kind: z.literal("use-candidate-fields"), operationId: uuidSchema, target: targetSchema,
    expectedCurrentEntityHash: hashSchema, fields: z.array(identifierSchema).min(1).readonly() }),
  z.strictObject({ kind: z.literal("insert-as-new"), sourceArtifactId: uuidSchema, sceneId: sceneIdSchema, gap: gapSchema, clientKey: identifierSchema }),
  z.strictObject({ kind: z.literal("regenerate-unit"), unitId: unitIdSchema, issueIds: z.array(uuidSchema).readonly() }),
]).readonly();
export type UnitProvenance = z.infer<typeof unitProvenanceSchema>;
export type ReuseAnalysis = z.infer<typeof reuseAnalysisSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;
