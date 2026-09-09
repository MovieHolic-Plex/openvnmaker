import { z } from "zod";
import {
  allocationReceiptSchema, operationReceiptSchema,
} from "./operations-receipts.js";
import {
  assertNever, candidateRefSchema, hashSchema, projectHeadSchema,
  runIdSchema, unitIdSchema, uuidSchema,
} from "./primitives.js";
import { toolEnvelopeSchema } from "./tool-contracts.js";
import { unitProvenanceSchema } from "./reuse-contracts.js";

export const reuseListEnvelopeSchema = toolEnvelopeSchema.transform((value, ctx) => {
  switch (value.tool) {
    case "patch_lines": case "patch_choices": return value;
    case "project_overview": case "search_content": case "read_scene":
    case "read_canon": case "propose_canon": case "patch_project":
    case "patch_state": case "create_scene": case "delete_scene":
    case "set_scene": case "upsert_character": case "request_art":
    case "validate_candidate":
      ctx.addIssue({ code: "custom", message: "Expected a list patch" });
      return z.NEVER;
    default: return assertNever(value);
  }
});

const successfulReceiptSchema = operationReceiptSchema.transform((value, ctx) => {
  switch (value.result.ok) {
    case true: return { ...value, result: value.result };
    case false:
      ctx.addIssue({ code: "custom", message: "Expected a successful receipt" });
      return z.NEVER;
    default: return assertNever(value.result);
  }
}).readonly();

/** Stored content, not an authorization to apply to any source head. */
export const reuseListPatchPayloadSchema = z.strictObject({
  version: z.literal(1), kind: z.literal("list-patch"),
  artifactId: uuidSchema, runId: runIdSchema, unitId: unitIdSchema,
  originHead: projectHeadSchema,
  inputRef: candidateRefSchema, outputRef: candidateRefSchema,
  inputSnapshotHash: hashSchema, outputSnapshotHash: hashSchema,
  operationIds: z.array(uuidSchema).min(1).max(100).readonly(),
  envelope: reuseListEnvelopeSchema,
  receipt: successfulReceiptSchema,
  allocations: z.array(allocationReceiptSchema).readonly(),
}).readonly();

/** Canonical payload bytes are a string so callers cannot mutate nested evidence. */
export const reuseListPatchArtifactSchema = z.strictObject({
  artifactId: uuidSchema, artifactHash: hashSchema, payload: z.string(),
}).readonly();

export const reuseAssemblyReceiptSchema = z.strictObject({
  receiptId: uuidSchema, candidateRef: candidateRefSchema,
  newBaseHead: projectHeadSchema,
  reusedFrom: unitProvenanceSchema.unwrap().shape.reusedFrom.unwrap(),
}).readonly();

export type ReuseListEnvelope = z.infer<typeof reuseListEnvelopeSchema>;
export type ReuseListPatchPayload = z.infer<typeof reuseListPatchPayloadSchema>;
export type ReuseListPatchArtifact = z.infer<typeof reuseListPatchArtifactSchema>;
export type ReuseAssemblyReceipt = z.infer<typeof reuseAssemblyReceiptSchema>;
