import { z } from "zod";
import { bytesSchema, errorCodeSchema, hashSchema, identifierSchema, positiveIntegerSchema, textSchema, uuidSchema } from "./primitives.js";
import { artRoleSchema, artTargetSchema } from "./production-contracts.js";

export const imageMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
export const compositingSchema = z.enum(["alpha", "legacy-chroma-key", "opaque"]);
export const transformIdSchema = z.enum(["green-key-v1", "alpha-preserve-v1", "reference-max-edge-v1"]);
export const imageFailureReasonSchema = z.enum(["html", "corrupt", "traversal", "remote-url", "unverified"]);
export const publicProvenanceSchema = z.strictObject({
  creator: textSchema.optional(), source: textSchema.optional(), license: textSchema.optional(), credit: textSchema.optional(),
}).readonly();
export const imageCapabilitySchema = z.strictObject({
  imageOutput: z.enum(["ready", "blocked"]), imageReference: z.enum(["ready", "blocked"]),
}).readonly();
export const referenceLineageEntrySchema = z.strictObject({
  bindingId: identifierSchema, originalHash: hashSchema, sentHash: hashSchema, mime: imageMimeSchema,
  width: positiveIntegerSchema, height: positiveIntegerSchema, rawBytes: bytesSchema,
}).readonly();
export const derivativeRecordSchema = z.strictObject({
  originalHash: hashSchema, deliveryHash: hashSchema, transformId: transformIdSchema,
  parameters: z.strictObject({ maxEdge: positiveIntegerSchema.optional() }).readonly(),
  dimensions: z.strictObject({ width: positiveIntegerSchema, height: positiveIntegerSchema }).readonly(),
  alphaBounds: z.strictObject({ minX: z.number().int().nonnegative(), minY: z.number().int().nonnegative(),
    maxX: z.number().int().nonnegative(), maxY: z.number().int().nonnegative() }).readonly(),
  compositing: compositingSchema,
}).readonly();
export const imageArtifactReceiptSchema = z.strictObject({
  artifactId: uuidSchema, hash: hashSchema, bytes: z.number().int().nonnegative(),
  originalHash: hashSchema, deliveryHash: hashSchema, sentHashes: z.array(hashSchema).readonly(),
  modelId: identifierSchema, mime: imageMimeSchema, width: positiveIntegerSchema, height: positiveIntegerSchema,
  role: artRoleSchema, target: artTargetSchema, referenceLineage: z.array(referenceLineageEntrySchema).readonly(),
  compositing: compositingSchema, publicProvenance: publicProvenanceSchema,
  verified: z.literal(true), proposalUsable: z.literal(true),
}).refine(row => row.hash === row.deliveryHash && !("prompt" in row) && !("privatePrompt" in row)).readonly();
export const imageEffectOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("duplicate"), effectId: uuidSchema, artifact: imageArtifactReceiptSchema, upstreamCalls: z.literal(0) }),
  z.strictObject({ kind: z.literal("payload-mismatch"), effectId: uuidSchema, code: z.literal("ID_PAYLOAD_CONFLICT"), upstreamCalls: z.literal(0) }),
  z.strictObject({ kind: z.literal("unsupported-reference"), effectId: uuidSchema, code: z.literal("CAPABILITY_REQUIRED"), upstreamCalls: z.literal(0) }),
  z.strictObject({
    kind: z.literal("unknown"), effectId: uuidSchema, reason: identifierSchema,
    reservation: z.strictObject({ imageAttempts: positiveIntegerSchema }).readonly(), upstreamCalls: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("known-failed"), effectId: uuidSchema, code: errorCodeSchema, reason: imageFailureReasonSchema,
    reservation: z.strictObject({ imageAttempts: z.number().int().nonnegative() }).readonly(), upstreamCalls: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("succeeded"), effectId: uuidSchema, artifact: imageArtifactReceiptSchema,
    reservation: z.strictObject({ imageAttempts: positiveIntegerSchema }).readonly(), upstreamCalls: positiveIntegerSchema,
  }),
]).readonly();
export const localDerivativeActionSchema = z.strictObject({
  kind: z.literal("rederive-delivery"), originalHash: hashSchema, deliveryHash: hashSchema,
  transformId: transformIdSchema, generationAttempts: z.literal(0), record: derivativeRecordSchema,
}).readonly();
export type PublicProvenance = z.infer<typeof publicProvenanceSchema>;
export type ImageCapability = z.infer<typeof imageCapabilitySchema>;
export type ImageArtifactReceipt = z.infer<typeof imageArtifactReceiptSchema>;
export type ImageEffectOutcome = z.infer<typeof imageEffectOutcomeSchema>;
export type DerivativeRecord = z.infer<typeof derivativeRecordSchema>;
export type LocalDerivativeAction = z.infer<typeof localDerivativeActionSchema>;
export type ImageFailureReason = z.infer<typeof imageFailureReasonSchema>;
