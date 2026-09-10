import { z } from "zod";
import { candidateRefSchema, counterSchema, errorCodeSchema, hashSchema, identifierSchema, lineageIdSchema, projectHeadSchema, projectIdSchema, revisionSchema, runIdSchema, timestampSchema, unitIdSchema, uuidSchema } from "./primitives.js";
import { budgetAdmissionSchema, budgetLimitsSchema, generationUsageSchema, tokenPolicySchema } from "./budget-contracts.js";
import { contextManifestSchema, readSetSchema, writeSetSchema } from "./context-contracts.js";
import { toolEnvelopeSchema } from "./tool-contracts.js";
import { validationReportSchema } from "./review-contracts.js";
import { unitProvenanceSchema } from "./reuse-contracts.js";

export const pauseReasonSchema = z.enum(["auth", "quota", "capability", "budget", "interrupted", "unknown-effect", "validation", "stale-source", "user"]);
export const runStatusSchema = z.enum(["planned", "idle", "running", "awaiting-review", "paused", "completed", "cancelled", "failed"]);
export const runStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("planned") }), z.strictObject({ status: z.literal("idle") }),
  z.strictObject({ status: z.literal("running") }), z.strictObject({ status: z.literal("awaiting-review") }),
  z.strictObject({ status: z.literal("paused"), reason: pauseReasonSchema }),
  z.strictObject({ status: z.literal("completed") }), z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({ status: z.literal("failed"), code: errorCodeSchema }),
]).readonly();
export type RunState = z.infer<typeof runStateSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
/** Transition contract only; services enforce command receipts, review/scope gates and version fencing. */
export const RUN_TRANSITIONS = {
  planned: ["running", "idle", "cancelled", "failed"], idle: ["running", "cancelled", "failed"],
  running: ["awaiting-review", "paused", "cancelled", "failed"],
  "awaiting-review": ["idle", "running", "completed", "cancelled", "failed"],
  paused: ["running", "cancelled", "failed"], completed: [], cancelled: [], failed: [],
} as const satisfies Readonly<Record<RunStatus, readonly RunStatus[]>>;
export const unitStatusSchema = z.enum(["pending", "running", "ready", "failed", "cancelled", "blocked"]);
export const unitKindSchema = z.enum(["outline", "scene-draft", "scene-repair", "image", "validation", "proposal"]);
const unitFields = {
  id: unitIdSchema, kind: unitKindSchema, dependencyHashes: z.array(hashSchema).readonly(),
  contextManifest: contextManifestSchema,
  repairFamilyId: uuidSchema.optional(), autoRepairRound: counterSchema,
};
export const unitSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...unitFields, status: z.literal("pending") }),
  z.strictObject({ ...unitFields, status: z.literal("running") }),
  z.strictObject({ ...unitFields, status: z.literal("ready"), provenance: unitProvenanceSchema }),
  z.strictObject({ ...unitFields, status: z.literal("failed"), code: errorCodeSchema }),
  z.strictObject({ ...unitFields, status: z.literal("cancelled") }),
  z.strictObject({ ...unitFields, status: z.literal("blocked"), reason: identifierSchema }),
]).readonly();
export const proposalSchema = z.strictObject({
  id: uuidSchema, runId: runIdSchema, baseHead: projectHeadSchema, operations: z.array(toolEnvelopeSchema).readonly(),
  requiredAssetHashes: z.array(hashSchema).readonly(), contextManifestHash: hashSchema,
  validation: validationReportSchema, digest: hashSchema,
}).readonly();
export const proposalStatusSchema = z.enum(["blocked", "ready", "superseded", "conflict", "applied", "rejected"]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export const PROPOSAL_TRANSITIONS = {
  blocked: ["ready", "superseded"], ready: ["superseded", "conflict", "applied", "rejected"],
  conflict: ["rejected", "superseded"], superseded: [], applied: [], rejected: [],
} as const satisfies Readonly<Record<ProposalStatus, readonly ProposalStatus[]>>;
const decisionFields = {
  receiptId: uuidSchema, projectId: projectIdSchema, lineageId: lineageIdSchema, proposalId: uuidSchema,
  proposalDigest: hashSchema, baseHead: projectHeadSchema, createdAt: timestampSchema,
};
export const decisionReceiptSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...decisionFields, kind: z.literal("applied"), resultHead: projectHeadSchema }),
  z.strictObject({ ...decisionFields, kind: z.literal("rejected"), resultHead: z.null() }),
]).refine(receipt => receipt.projectId === receipt.baseHead.projectId && receipt.lineageId === receipt.baseHead.lineageId &&
  (receipt.resultHead === null || receipt.resultHead.projectId === receipt.projectId && receipt.resultHead.lineageId === receipt.lineageId && receipt.resultHead.revision > receipt.baseHead.revision)).readonly();
export const artifactReceiptSchema = z.strictObject({ artifactId: uuidSchema, hash: hashSchema, bytes: counterSchema }).readonly();
const effectFields = { effectId: uuidSchema, payloadHash: hashSchema, admission: budgetAdmissionSchema, replacesEffectId: uuidSchema.optional() };
export const effectSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...effectFields, state: z.literal("intent") }),
  z.strictObject({ ...effectFields, state: z.literal("dispatched") }),
  z.strictObject({ ...effectFields, state: z.literal("succeeded"), artifact: artifactReceiptSchema, usage: generationUsageSchema }),
  z.strictObject({ ...effectFields, state: z.literal("known-failed"), code: errorCodeSchema }),
  z.strictObject({ ...effectFields, state: z.literal("unknown"), reason: identifierSchema }),
]).readonly();
export const runSchema = z.strictObject({
  schemaVersion: z.literal(1), id: runIdSchema, version: revisionSchema, sourceHead: projectHeadSchema,
  candidateRef: candidateRefSchema, state: runStateSchema, units: z.array(unitSchema).readonly(),
  proposalIds: z.array(uuidSchema).readonly(), budgetGroupId: uuidSchema, budgetOwnerRunId: runIdSchema,
  limitVersion: revisionSchema, limits: budgetLimitsSchema, tokenPolicy: tokenPolicySchema,
  lastEventSeq: counterSchema, ownerEpoch: counterSchema, createdAt: timestampSchema,
}).readonly();
export const errorEnvelopeSchema = z.strictObject({
  code: errorCodeSchema, message: identifierSchema, retryable: z.boolean(),
  runId: runIdSchema.optional(), unitId: unitIdSchema.optional(), lastEventSeq: counterSchema.optional(),
}).readonly();
export const toolResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), callId: uuidSchema, candidateRef: candidateRefSchema,
    changed: z.boolean(), data: z.json(), readSet: readSetSchema, writeSet: writeSetSchema }),
  z.strictObject({ ok: z.literal(false), callId: uuidSchema, code: errorCodeSchema, message: identifierSchema,
    currentCandidateRef: candidateRefSchema, retryHint: z.array(z.strictObject({
      tool: z.enum(["project_overview", "search_content", "read_scene", "read_canon"]), target: identifierSchema,
    }).readonly()).readonly() }),
]).readonly();
export type Run = z.infer<typeof runSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
