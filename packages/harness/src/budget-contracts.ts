import { z } from "zod";
import { assertNever, bytesSchema, counterSchema, hashSchema, identifierSchema, positiveIntegerSchema, revisionSchema, tokensSchema, uuidSchema } from "./primitives.js";

export const HARD_TRANSPORT_LIMITS = { imageInputs: 4, wireBodyBytes: 20 * 1024 * 1024, snapshotBodyBytes: 8 * 1024 * 1024 } as const;
export const TOKEN_SAFETY_RESERVE = 4096;
export const tokenPolicySchema = z.enum(["exact-only", "bounded-payload"]);
export const tokenWindowModeSchema = z.enum(["input-only", "combined", "unknown"]);
export const attemptCountersSchema = z.strictObject({ textAttempts: counterSchema, imageAttempts: counterSchema, countRequests: counterSchema }).readonly();
export const requestLimitsSchema = z.strictObject({
  textContextBytes: positiveIntegerSchema, maxOutputTokens: positiveIntegerSchema,
  imageInputs: counterSchema.max(4), singleImageRawBytes: positiveIntegerSchema, allImageRawBytes: positiveIntegerSchema,
  wireBodyBytes: positiveIntegerSchema.max(HARD_TRANSPORT_LIMITS.wireBodyBytes),
  maxImagePixels: positiveIntegerSchema, referenceMaxEdge: positiveIntegerSchema,
});
export const budgetLimitsSchema = z.strictObject({
  run: attemptCountersSchema, chapter: attemptCountersSchema, request: requestLimitsSchema.readonly(), maxAutoRepairRounds: counterSchema,
}).readonly();
export const DEFAULT_BUDGET_LIMITS = budgetLimitsSchema.parse({
  run: { textAttempts: 288, imageAttempts: 72, countRequests: 360 },
  chapter: { textAttempts: 48, imageAttempts: 12, countRequests: 60 },
  request: { textContextBytes: 65536, maxOutputTokens: 8192, imageInputs: 4,
    singleImageRawBytes: 8 * 1024 * 1024, allImageRawBytes: 12 * 1024 * 1024, wireBodyBytes: 20 * 1024 * 1024,
    maxImagePixels: 16777216, referenceMaxEdge: 1024 }, maxAutoRepairRounds: 2,
});
export const requestImageSchema = z.strictObject({
  originalHash: hashSchema, sentHash: hashSchema, mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width: positiveIntegerSchema, height: positiveIntegerSchema, rawBytes: bytesSchema,
}).readonly();
export const capabilityBindingSchema = z.strictObject({
  accountScope: identifierSchema, providerProjectId: identifierSchema, modelId: identifierSchema, configDigest: hashSchema,
  evidenceHash: hashSchema, counterSupport: z.enum(["exact", "unsupported"]), tokenWindowMode: tokenWindowModeSchema,
  inputTokenLimit: positiveIntegerSchema.nullable(), outputTokenLimit: positiveIntegerSchema.nullable(),
  combinedTokenLimit: positiveIntegerSchema.nullable(), ready: z.boolean(),
  requestLimits: requestLimitsSchema.partial().readonly().optional(),
}).readonly();
export const tokenCounterResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exact"), requestPayloadHash: hashSchema, capabilityBindingHash: hashSchema,
    inputTokens: tokensSchema, includes: z.strictObject({ text: z.boolean(), tools: z.boolean(), history: z.boolean(), opaque: z.boolean(), images: z.boolean() }).readonly() }),
  z.strictObject({ kind: z.literal("unsupported") }),
  z.strictObject({ kind: z.literal("error"), code: z.enum(["auth", "quota", "transport"]) }),
]).readonly();
export const budgetRequestSchema = z.strictObject({
  requestPayloadHash: hashSchema, capabilityBindingHash: hashSchema, budgetGroupId: uuidSchema,
  limitVersion: revisionSchema, textContextBytes: bytesSchema, wireBodyBytes: bytesSchema,
  images: z.array(requestImageSchema).readonly(), requestedOutputTokens: tokensSchema,
  counter: tokenCounterResultSchema, capability: capabilityBindingSchema, limits: budgetLimitsSchema,
  policy: tokenPolicySchema, boundedPayloadApproved: z.boolean(), unitAuthorized: z.boolean(),
  used: z.strictObject({ run: attemptCountersSchema, chapter: attemptCountersSchema }).readonly(),
  reserve: attemptCountersSchema, autoRepairRound: counterSchema,
}).readonly();
export const budgetAdmissionSchema = z.strictObject({
  requestPayloadHash: hashSchema, capabilityBindingHash: hashSchema, budgetGroupId: uuidSchema, limitVersion: revisionSchema,
  textContextBytes: bytesSchema, wireBodyBytes: bytesSchema, images: z.array(requestImageSchema).readonly(),
  countedInputTokens: tokensSchema.nullable(), tokenWindowMode: tokenWindowModeSchema, requestedOutputTokens: tokensSchema,
  tokenCheck: z.enum(["pass", "fail", "unknown"]), policy: tokenPolicySchema, allowed: z.boolean(), reason: identifierSchema.nullable(),
  authorization: z.enum(["exact-approved", "bounded-payload-approved"]).nullable(),
}).refine(value => {
  if (!value.allowed) return value.reason !== null && value.authorization === null;
  if (value.reason !== null) return false;
  switch (value.tokenCheck) {
    case "fail": return false;
    case "pass": return value.countedInputTokens !== null && value.tokenWindowMode !== "unknown" && value.authorization === "exact-approved";
    case "unknown": return value.policy === "bounded-payload" && value.authorization === "bounded-payload-approved";
    default: return assertNever(value.tokenCheck);
  }
}).readonly();
export const generationUsageSchema = z.strictObject({ knownInputUsage: tokensSchema.nullable(), knownOutputUsage: tokensSchema.nullable() }).readonly();
export type BudgetLimits = z.infer<typeof budgetLimitsSchema>;
export type BudgetRequest = z.infer<typeof budgetRequestSchema>;
export type BudgetAdmission = z.infer<typeof budgetAdmissionSchema>;
export type CapabilityBinding = z.infer<typeof capabilityBindingSchema>;
export type TokenPolicy = z.infer<typeof tokenPolicySchema>;
export type TokenWindowMode = z.infer<typeof tokenWindowModeSchema>;
export type TokenCounterResult = z.infer<typeof tokenCounterResultSchema>;
