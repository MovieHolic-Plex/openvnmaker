import { z } from "zod";
import { choiceIdSchema, hashSchema, identifierSchema, lineIdSchema, sceneIdSchema, textSchema, uuidSchema } from "./primitives.js";
import { contextWindowSchema, targetSchema } from "./context-contracts.js";

export const reviewScopeSchema = z.strictObject({
  chapterIds: z.array(identifierSchema).readonly(), sceneIds: z.array(sceneIdSchema).readonly(),
  lines: z.array(z.strictObject({ sceneId: sceneIdSchema, lineId: lineIdSchema }).readonly()).readonly(),
  choices: z.array(z.strictObject({ sceneId: sceneIdSchema, choiceId: choiceIdSchema }).readonly()).readonly(),
  assetIds: z.array(identifierSchema).readonly(),
}).readonly();
export const evidenceSchema = z.strictObject({
  target: targetSchema, sourceHash: hashSchema, excerpt: textSchema.optional(),
  region: z.strictObject({ x: z.number().nonnegative(), y: z.number().nonnegative(),
    width: z.number().positive(), height: z.number().positive() }).readonly().optional(),
}).readonly();
export const issueSchema = z.strictObject({
  id: uuidSchema, repairFamilyId: uuidSchema, category: z.enum([
    "structure", "voice", "motivation", "continuity", "branch-knowledge", "route-payoff", "foreshadow", "duration",
    "repetition", "cast-identity", "art-direction", "pose", "crop", "compositing", "required-asset", "stale-source",
  ]), severity: z.enum(["blocking", "repair", "note"]), targets: z.array(targetSchema).readonly(),
  evidence: z.array(evidenceSchema).readonly(), requestedChange: textSchema,
}).readonly();
export const reviewDispositionSchema = z.enum(["pass", "changes-required", "unverified", "accepted-with-notes"]);
export const reviewRecordSchema = z.strictObject({
  reviewId: uuidSchema, candidateDigest: hashSchema, kind: z.enum(["plan", "chapter", "edit", "asset"]),
  scope: reviewScopeSchema, coverage: z.array(contextWindowSchema).readonly(),
  checks: z.array(z.strictObject({ id: identifierSchema, status: z.enum(["pass", "fail", "unverified"]), evidence: z.array(evidenceSchema).readonly() }).readonly()).readonly(),
  issues: z.array(issueSchema).readonly(), disposition: reviewDispositionSchema,
  acceptedNotes: z.array(z.strictObject({ issueId: uuidSchema, reason: identifierSchema }).readonly()).readonly().optional(),
}).readonly();
export const validationReportSchema = z.strictObject({
  schema: z.boolean(), graph: z.boolean(), assets: z.boolean(), runtime: z.boolean(),
  requiredAssetsMissing: z.array(identifierSchema).readonly(), issues: z.array(issueSchema).readonly(),
  reviewIds: z.array(uuidSchema).readonly(),
}).readonly();
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
