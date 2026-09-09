import { z } from "zod";
import { assertNever, hashSchema, identifierSchema, parseDto, timestampSchema } from "./primitives.js";
import { capabilityBindingSchema } from "./budget-contracts.js";

export const PRODUCTION_TEXT_MODEL_ID = "gemini-3.8-flash-high";
export const PRODUCTION_IMAGE_MODEL_ID = "gemini-3.1-flash-image";
export const productionCapabilityContextSchema = z.strictObject({
  accountScope: identifierSchema, providerProjectId: identifierSchema, configDigest: hashSchema,
  textModelId: identifierSchema, imageModelId: identifierSchema,
}).readonly();
export const productionCapabilityProofSchema = z.strictObject({
  modelId: identifierSchema, contextHash: hashSchema, evidenceHash: hashSchema, observedAt: timestampSchema,
  requestHashes: z.array(hashSchema).min(1).readonly(), responseHashes: z.array(hashSchema).min(1).readonly(),
  text: z.boolean(), tools: z.boolean(), opaqueRoundtrip: z.boolean(), imageOutput: z.boolean(), imageReference: z.boolean(),
}).readonly();
export const opaqueMetadataProbeContractSchema = z.strictObject({
  kind: z.literal("opaque-metadata-preservation"), preserveModelContentParts: z.literal(true),
  preserveFunctionCallIds: z.literal(true), preserveOpaqueSignatures: z.literal(true), replayByteEquivalent: z.literal(true),
  exposeThought: z.literal(false), unknownTokenCheckIsNotPass: z.literal(true), unknownEffectDoesNotAutoreplay: z.literal(true),
}).readonly();
export const OPAQUE_METADATA_PROBE_CONTRACT = opaqueMetadataProbeContractSchema.parse({
  kind: "opaque-metadata-preservation", preserveModelContentParts: true, preserveFunctionCallIds: true,
  preserveOpaqueSignatures: true, replayByteEquivalent: true, exposeThought: false,
  unknownTokenCheckIsNotPass: true, unknownEffectDoesNotAutoreplay: true,
});
export const capabilityAuthStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("missing") }),
  z.strictObject({ kind: z.literal("expired"), accountScope: identifierSchema.optional(), providerProjectId: identifierSchema }),
  z.strictObject({ kind: z.literal("present"), accountScope: identifierSchema, providerProjectId: identifierSchema }),
]).readonly();
export const capabilityBlockSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("auth"), code: z.enum(["AUTH_REQUIRED", "AUTH_EXPIRED"]) }),
  z.strictObject({ kind: z.literal("quota"), code: z.literal("QUOTA"), remainingFraction: z.literal(0) }),
  z.strictObject({ kind: z.literal("capability"), code: z.enum(["MODEL_MISSING", "VISION_ONLY", "CONFIG_MODEL_MISMATCH", "PROBE_STALE", "PROBE_FAILED"]) }),
]).readonly();
export const featureReadinessSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ready"), evidenceHash: hashSchema }),
  z.strictObject({ status: z.literal("unverified"), reason: z.literal("live-probe-required") }),
  z.strictObject({ status: z.literal("blocked"), block: capabilityBlockSchema }),
]).readonly();
export const productionModelReadinessSchema = z.strictObject({
  modelId: identifierSchema, present: z.boolean(), inputVision: z.boolean(),
  remainingFraction: z.number().nullable(), resetTime: identifierSchema.nullable(),
  text: featureReadinessSchema, tools: featureReadinessSchema,
  imageOutput: featureReadinessSchema, imageReference: featureReadinessSchema,
  binding: capabilityBindingSchema,
}).readonly();
export const productionCapabilityReportSchema = z.strictObject({
  context: productionCapabilityContextSchema, contextHash: hashSchema,
  text: productionModelReadinessSchema, image: productionModelReadinessSchema,
  productionReady: z.boolean(), liveVerification: z.literal("not-performed"),
}).refine(report => report.liveVerification === "not-performed" && (!report.productionReady ||
  report.text.modelId === PRODUCTION_TEXT_MODEL_ID && report.image.modelId === PRODUCTION_IMAGE_MODEL_ID)).readonly();
export const parseProductionCapabilityContext = (input: unknown) => parseDto(productionCapabilityContextSchema, input);
export const parseProductionCapabilityProof = (input: unknown) => parseDto(productionCapabilityProofSchema, input);
export const parseProductionCapabilityReport = (input: unknown) => parseDto(productionCapabilityReportSchema, input);
export function featureBlockCode(feature: z.infer<typeof featureReadinessSchema>): string | null {
  switch (feature.status) {
    case "ready": case "unverified": return null;
    case "blocked": return feature.block.code;
    default: return assertNever(feature);
  }
}
export type ProductionCapabilityContext = z.infer<typeof productionCapabilityContextSchema>;
export type ProductionCapabilityProof = z.infer<typeof productionCapabilityProofSchema>;
export type ProductionCapabilityReport = z.infer<typeof productionCapabilityReportSchema>;
export type CapabilityAuthState = z.infer<typeof capabilityAuthStateSchema>;
export type CapabilityBlock = z.infer<typeof capabilityBlockSchema>;
export type FeatureReadiness = z.infer<typeof featureReadinessSchema>;
