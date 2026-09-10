import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { targetSchema, writeSetSchema } from "./context-contracts.js";
import { toolResultSchema } from "./lifecycle-contracts.js";
import {
  assertNever, candidateIdSchema, hashSchema, identifierSchema, unitIdSchema,
} from "./primitives.js";
import type { CandidateId } from "./primitives.js";

const allocationTargetSchema = targetSchema.transform((target, ctx) => {
  switch (target.kind) {
    case "line": case "choice": return target;
    case "scene": case "character": case "canon":
    case "asset": case "project": case "state":
      ctx.addIssue({ code: "custom", message: "Allocation requires a narrative target" });
      return z.NEVER;
    default: return assertNever(target);
  }
});

export const operationReceiptSchema = z.strictObject({
  unitId: unitIdSchema,
  payloadHash: hashSchema,
  requiredWriteSet: writeSetSchema,
  result: toolResultSchema,
}).readonly();

export const allocationReceiptSchema = z.strictObject({
  unitId: unitIdSchema,
  clientKey: identifierSchema,
  target: allocationTargetSchema,
  valueHash: hashSchema,
}).readonly();

/** Repository-owned history, committed atomically with the returned candidate. */
export const operationJournalSchema = z.strictObject({
  candidateId: candidateIdSchema,
  calls: z.array(operationReceiptSchema).readonly(),
  allocations: z.array(allocationReceiptSchema).readonly(),
}).superRefine((journal, ctx) => {
  const callIds = new Set<string>();
  for (const [index, call] of journal.calls.entries()) {
    if (callIds.has(call.result.callId)) {
      ctx.addIssue({
        code: "custom", path: ["calls", index, "result", "callId"],
        message: "Duplicate call receipt",
      });
    }
    callIds.add(call.result.callId);
    let candidateId: CandidateId;
    switch (call.result.ok) {
      case true: candidateId = call.result.candidateRef.candidateId; break;
      case false: candidateId = call.result.currentCandidateRef.candidateId; break;
      default: return assertNever(call.result);
    }
    if (candidateId !== journal.candidateId) {
      ctx.addIssue({
        code: "custom", path: ["calls", index, "result"],
        message: "Receipt belongs to another candidate",
      });
    }
  }
  const allocationKeys = new Set<string>();
  for (const [index, allocation] of journal.allocations.entries()) {
    const key = canonicalJson([allocation.unitId, allocation.clientKey]);
    if (allocationKeys.has(key)) {
      ctx.addIssue({
        code: "custom", path: ["allocations", index, "clientKey"],
        message: "Duplicate allocation owner",
      });
    }
    allocationKeys.add(key);
  }
}).readonly();

export type OperationJournal = z.infer<typeof operationJournalSchema>;
export type AllocationReceipt = z.infer<typeof allocationReceiptSchema>;
