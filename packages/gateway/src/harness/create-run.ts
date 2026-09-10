import { parseRun, uuidSchema } from "../../../harness/src/index.js";
import type { CreateRunCommand, Run } from "../../../harness/src/index.js";

export function runFromCreate(command: CreateRunCommand, ids: { readonly uuid: () => string }, createdAt: string): Run {
  const id = uuidSchema.parse(ids.uuid());
  const candidateId = uuidSchema.parse(ids.uuid());
  const budgetGroupId = uuidSchema.parse(ids.uuid());
  const state = command.initialScope === "imported-draft" ? { status: "idle" as const } : { status: "running" as const };
  return parseRun({
    schemaVersion: 1, id, version: 0, sourceHead: command.sourceHead,
    candidateRef: { candidateId, revision: 0 }, state, units: [], proposalIds: [],
    budgetGroupId, budgetOwnerRunId: id, limitVersion: 0, limits: command.limits,
    tokenPolicy: command.tokenPolicy, lastEventSeq: 0, ownerEpoch: 0, createdAt,
  });
}
