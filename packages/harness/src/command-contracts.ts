import { z } from "zod";
import { choiceIdSchema, hashSchema, identifierSchema, lineIdSchema, projectHeadSchema, revisionSchema, sceneIdSchema, textSchema, unitIdSchema, uuidSchema } from "./primitives.js";
import { budgetLimitsSchema, tokenPolicySchema } from "./budget-contracts.js";
import { approvedArtBindingSchema, productionDocumentSchema } from "./production-contracts.js";
import { scriptSchema } from "./script-contracts.js";
import { importedCandidateSeedSchema, previewEntrySchema } from "./snapshot-contracts.js";
import { decisionReceiptSchema } from "./lifecycle-contracts.js";
import { resolutionSchema } from "./reuse-contracts.js";

export const commandFields = { requestId: uuidSchema, expectedRunVersion: revisionSchema } as const;
const budgetFields = { limits: budgetLimitsSchema, tokenPolicy: tokenPolicySchema } as const;
const createFields = { requestId: uuidSchema, sourceHead: projectHeadSchema, script: scriptSchema, productionDocument: productionDocumentSchema, ...budgetFields } as const;
export const createRunCommandSchema = z.discriminatedUnion("initialScope", [
  z.strictObject({ ...createFields, initialScope: z.literal("plan"), brief: textSchema, targetMinutes: z.number().positive() }),
  z.strictObject({ ...createFields, initialScope: z.literal("edit"), selection: z.strictObject({
    sceneId: sceneIdSchema, lineIds: z.array(lineIdSchema).readonly().optional(), choiceIds: z.array(choiceIdSchema).readonly().optional(),
  }).readonly(), instruction: textSchema }),
  z.strictObject({ ...createFields, initialScope: z.literal("imported-draft"), importedCandidateSeed: importedCandidateSeedSchema, archiveHash: hashSchema }),
]).readonly();
export const startCommandSchema = z.strictObject({
  ...commandFields, scope: z.strictObject({ kind: z.enum(["references", "chapter"]),
    chapterIds: z.array(identifierSchema).readonly(), unitIds: z.array(unitIdSchema).min(1).readonly() }).readonly(),
  reviewDigest: hashSchema, ...budgetFields,
});
export const approveCommandSchema = z.strictObject({
  ...commandFields, stage: z.enum(["plan", "asset", "chapter", "edit"]), reviewId: uuidSchema, reviewDigest: hashSchema,
  unitIds: z.array(unitIdSchema).readonly(), assetBinding: approvedArtBindingSchema.optional(),
});
export const requestChangesCommandSchema = z.strictObject({
  ...commandFields, reviewId: uuidSchema, reviewDigest: hashSchema, issueIds: z.array(uuidSchema).min(1).readonly(), instruction: textSchema, ...budgetFields,
});
export const pauseCommandSchema = z.strictObject({ ...commandFields, reason: z.enum(["user", "stale-source"]), observedSourceHead: projectHeadSchema.optional() });
export const resumeCommandSchema = z.strictObject({ ...commandFields, observedSourceHead: projectHeadSchema, capabilityBindingHash: hashSchema });
export const budgetCommandSchema = z.strictObject({ ...commandFields, ...budgetFields, expectedLimitVersion: revisionSchema, reason: identifierSchema });
export const retryEffectCommandSchema = z.strictObject({ ...commandFields, effectId: uuidSchema, payloadHash: hashSchema, authorizeReplacement: z.literal(true) });
export const cancelCommandSchema = z.strictObject({ ...commandFields, reason: textSchema });
export const reproposeCommandSchema = z.strictObject({
  ...commandFields, analysisId: uuidSchema, analysisDigest: hashSchema, newBaseHead: projectHeadSchema,
  reuseUnitIds: z.array(unitIdSchema).readonly(), reuseAssetIds: z.array(identifierSchema).readonly(), resolutions: z.array(resolutionSchema).readonly(),
});
export const previewCommandSchema = z.strictObject({
  requestId: uuidSchema, expectedCandidateRevision: revisionSchema, entry: previewEntrySchema, allowMissingAssetPlaceholders: z.boolean(),
});
export const decisionAckSchema = z.strictObject({ requestId: uuidSchema, decisionReceipt: decisionReceiptSchema }).readonly();
const analysisFields = { ...commandFields, sourceDigest: hashSchema, newBaseHead: projectHeadSchema, script: scriptSchema, productionDocument: productionDocumentSchema } as const;
export const reuseAnalysisCommandSchema = z.union([
  z.strictObject({ ...analysisFields, sourceProposalId: uuidSchema }),
  z.strictObject({ ...analysisFields, sourceCandidateSnapshotId: uuidSchema }),
]).readonly();
/** action is the local dispatch tag; HTTP bodies use the individual schemas above. */
export const runCommandSchema = z.discriminatedUnion("action", [
  startCommandSchema.extend({ action: z.literal("start") }), approveCommandSchema.extend({ action: z.literal("approve") }),
  requestChangesCommandSchema.extend({ action: z.literal("request-changes") }), pauseCommandSchema.extend({ action: z.literal("pause") }),
  resumeCommandSchema.extend({ action: z.literal("resume") }), budgetCommandSchema.extend({ action: z.literal("budget") }),
  retryEffectCommandSchema.extend({ action: z.literal("retry-effect") }), cancelCommandSchema.extend({ action: z.literal("cancel") }),
  reproposeCommandSchema.extend({ action: z.literal("repropose") }), previewCommandSchema.extend({ action: z.literal("previews") }),
]).readonly();
export type CreateRunCommand = z.infer<typeof createRunCommandSchema>;
export type RunCommand = z.infer<typeof runCommandSchema>;
export type ReuseAnalysisCommand = z.infer<typeof reuseAnalysisCommandSchema>;
export type DecisionAck = z.infer<typeof decisionAckSchema>;
