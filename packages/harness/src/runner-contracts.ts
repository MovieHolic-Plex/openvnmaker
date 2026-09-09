import { z } from "zod";
import { artifactReceiptSchema, effectSchema, runSchema, unitKindSchema } from "./lifecycle-contracts.js";
import type { Effect, Run } from "./lifecycle-contracts.js";
import {
  attemptCountersSchema, budgetAdmissionSchema, capabilityBindingSchema, generationUsageSchema, tokenCounterResultSchema,
} from "./budget-contracts.js";
import type { BudgetAdmission, CapabilityBinding, TokenCounterResult } from "./budget-contracts.js";
import { counterSchema, errorCodeSchema, hashSchema, identifierSchema, unitIdSchema, uuidSchema } from "./primitives.js";
import type { Sha256 } from "./primitives.js";

export const LEASE_DURATION_MS = 30_000;
export const LEASE_HEARTBEAT_MS = 10_000;

export const leaseSchema = z.strictObject({
  scopeHash: hashSchema, holderId: uuidSchema, epoch: counterSchema.min(1), expiresAt: counterSchema,
}).readonly();
export const runnerMetaSchema = z.strictObject({
  scopeUnitIds: z.array(unitIdSchema).readonly(), chapterId: identifierSchema, capabilityBindingHash: hashSchema,
  accountScope: identifierSchema, providerProjectId: identifierSchema, holderId: uuidSchema,
  boundedPayloadApproved: z.boolean(), authorizedReplacements: z.array(uuidSchema).readonly(),
  leaseScopeHash: hashSchema.nullable(),
}).readonly();
export const runnerSnapshotSchema = z.strictObject({
  run: runSchema, meta: runnerMetaSchema, effects: z.array(effectSchema).readonly(),
  used: z.strictObject({
    run: attemptCountersSchema,
    chapters: z.array(z.strictObject({ chapterId: identifierSchema, used: attemptCountersSchema }).readonly()).readonly(),
  }).readonly(),
}).readonly();
export const providerDispatchResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), artifact: artifactReceiptSchema, usage: generationUsageSchema }),
  z.strictObject({ kind: z.literal("known-failed"), code: errorCodeSchema }),
  z.strictObject({ kind: z.literal("unknown"), reason: identifierSchema }),
  z.strictObject({ kind: z.literal("auth") }), z.strictObject({ kind: z.literal("quota") }),
  z.strictObject({ kind: z.literal("capability") }), z.strictObject({ kind: z.literal("context-limit") }),
]).readonly();
export const stepStopReasonSchema = z.enum([
  "unit-ready", "unit-failed", "cancelled", "fenced", "awaiting-review", "completed", "idle",
  "paused-auth", "paused-quota", "paused-capability", "paused-budget", "paused-interrupted",
  "paused-unknown-effect", "paused-validation", "paused-stale-source", "paused-user", "blocked-unknown-effect",
]);
export const stepReceiptSchema = z.strictObject({
  unitId: unitIdSchema.nullable(), effectId: uuidSchema.nullable(), dispatched: counterSchema, stopReason: stepStopReasonSchema,
}).readonly();

export type Lease = z.infer<typeof leaseSchema>;
export type RunnerMeta = z.infer<typeof runnerMetaSchema>;
export type RunnerSnapshot = z.infer<typeof runnerSnapshotSchema>;
export type ProviderDispatchResult = z.infer<typeof providerDispatchResultSchema>;
export type StepReceipt = z.infer<typeof stepReceiptSchema>;
export type StepStopReason = z.infer<typeof stepStopReasonSchema>;
export type ProviderDispatchRequest = {
  readonly effectId: string; readonly unitId: z.infer<typeof unitIdSchema>; readonly runId: Run["id"];
  readonly payloadHash: Sha256; readonly admission: BudgetAdmission;
  readonly kind: z.infer<typeof unitKindSchema>; readonly signal: AbortSignal;
};
export type ProviderDispatch = { readonly dispatch: (request: ProviderDispatchRequest) => Promise<ProviderDispatchResult> };
export type RunnerEvent =
  | { readonly type: "state"; readonly run: Run }
  | { readonly type: "step"; readonly receipt: StepReceipt }
  | { readonly type: "effect"; readonly effect: Effect }
  | { readonly type: "dispatch-barrier"; readonly effectId: string; readonly unitId: z.infer<typeof unitIdSchema> };
export type TokenCounterPort = {
  readonly count: (input: { readonly requestPayloadHash: Sha256; readonly capabilityBindingHash: Sha256 }) =>
    TokenCounterResult | Promise<TokenCounterResult>;
};
export type RunnerClock = { readonly now: () => number };
export type RunnerIds = { readonly uuid: () => string };
export type RunnerStore = {
  transaction<T>(body: () => T): T;
  list(): readonly string[];
  load(runId: string): RunnerSnapshot | null;
  save(snapshot: RunnerSnapshot): void;
  loadLease(scopeHash: string): Lease | null;
  saveLease(lease: Lease): void;
  loadReceipt(requestId: string): { readonly payloadHash: string; readonly snapshot: RunnerSnapshot } | null;
  saveReceipt(requestId: string, payloadHash: string, snapshot: RunnerSnapshot): void;
};
export type RunnerDeps = {
  readonly store: RunnerStore; readonly dispatch: ProviderDispatch; readonly clock: RunnerClock;
  readonly ids: RunnerIds; readonly capability: CapabilityBinding; readonly counter: TokenCounterPort;
  readonly beforeDispatch?: (request: ProviderDispatchRequest) => Promise<void>;
};
export type ProductionRunner = {
  readonly subscribe: (listener: (event: RunnerEvent) => void) => () => void;
  readonly getRun: (id: string) => Run;
  readonly getSnapshot: (id: string) => RunnerSnapshot;
  readonly create: (request: string, run: Run) => Promise<Run>;
  readonly apply: (runId: string, command: unknown) => Promise<Run>;
  readonly disconnect: (runId: string) => void;
  readonly recover: (now: number) => readonly Run[];
  readonly pump: (runId: string) => Promise<StepReceipt>;
  readonly heartbeat: (now: number) => void;
};
