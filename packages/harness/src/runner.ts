import { canonicalHash } from "./canonical.js";
import { parseRun } from "./parsers.js";
import { HarnessError, uuidSchema } from "./primitives.js";
import type { Run } from "./lifecycle-contracts.js";
import { applyCommand } from "./runner-commands.js";
import type { CommandContext } from "./runner-commands.js";
import { leaseScopeHash, renewLease } from "./runner-lease.js";
import { interruptSnapshot } from "./runner-recover.js";
import { pumpRun } from "./runner-step.js";
import type {
  ProductionRunner, RunnerDeps, RunnerEvent, RunnerSnapshot, StepReceipt,
} from "./runner-contracts.js";

export function createProductionRunner(deps: RunnerDeps): ProductionRunner {
  const holderId = uuidSchema.parse(deps.ids.uuid());
  const listeners = new Set<(event: RunnerEvent) => void>();
  const aborts = new Map<string, AbortController>();
  const emit = (event: RunnerEvent): void => { for (const listener of [...listeners]) listener(event); };
  const ctx = (): CommandContext => ({
    deps, holderId, emit,
    abort: (runId) => { aborts.get(runId)?.abort(); },
    setAbort: (runId, controller) => { aborts.set(runId, controller); },
  });
  const must = (runId: string): RunnerSnapshot => {
    const snapshot = deps.store.load(runId);
    if (snapshot === null) throw new HarnessError("INVALID_STATE");
    return snapshot;
  };
  return {
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getRun: (id) => must(id).run,
    getSnapshot: (id) => must(id),
    create: async (request, run) => createRun(deps, holderId, emit, request, run),
    apply: async (runId, command) => applyCommand(ctx(), runId, command),
    disconnect: (runId) => { emit({ type: "state", run: must(runId).run }); },
    recover: (now) => recoverRuns(deps, emit, now),
    pump: async (runId) => pumpRun(ctx(), runId),
    heartbeat: (now) => heartbeat(deps, now, holderId),
  };
}

async function createRun(
  deps: RunnerDeps, holderId: string, emit: (event: RunnerEvent) => void, request: string, run: Run,
): Promise<Run> {
  const parsed = parseRun(run);
  const requestId = uuidSchema.parse(request);
  const hash = await canonicalHash({ kind: "create", requestId, run: parsed });
  const receipt = deps.store.loadReceipt(requestId);
  if (receipt !== null) {
    if (receipt.payloadHash !== hash) throw new HarnessError("ID_PAYLOAD_CONFLICT");
    return receipt.snapshot.run;
  }
  if (parsed.version !== 0 || parsed.lastEventSeq !== 0 || parsed.ownerEpoch !== 0) throw new HarnessError("INVALID_STATE");
  if (parsed.budgetOwnerRunId !== parsed.id) {
    const owner = deps.store.load(parsed.budgetOwnerRunId);
    if (owner === null || owner.run.budgetGroupId !== parsed.budgetGroupId) throw new HarnessError("INVALID_STATE");
  }
  const capabilityBindingHash = await canonicalHash(deps.capability);
  const scopeHash = await leaseScopeHash(deps.capability.accountScope, deps.capability.providerProjectId);
  const snapshot: RunnerSnapshot = {
    run: parsed,
    meta: {
      scopeUnitIds: [], chapterId: "ch1", capabilityBindingHash,
      accountScope: deps.capability.accountScope, providerProjectId: deps.capability.providerProjectId,
      holderId, boundedPayloadApproved: parsed.tokenPolicy === "bounded-payload",
      authorizedReplacements: [], leaseScopeHash: scopeHash,
    },
    effects: [],
    used: { run: { textAttempts: 0, imageAttempts: 0, countRequests: 0 }, chapters: [] },
  };
  deps.store.save(snapshot);
  deps.store.saveReceipt(requestId, hash, snapshot);
  emit({ type: "state", run: parsed });
  return parsed;
}

function recoverRuns(deps: RunnerDeps, emit: (event: RunnerEvent) => void, now: number): readonly Run[] {
  const recovered: Run[] = [];
  for (const id of deps.store.list()) {
    const snapshot = deps.store.load(id);
    if (snapshot === null || snapshot.run.state.status !== "running") continue;
    const scope = snapshot.meta.leaseScopeHash;
    const lease = scope === null ? null : deps.store.loadLease(scope);
    const live = lease !== null && lease.expiresAt > now && lease.holderId === snapshot.meta.holderId &&
      lease.epoch === snapshot.run.ownerEpoch;
    if (live) continue;
    const next = interruptSnapshot(snapshot);
    deps.store.save(next);
    emit({ type: "state", run: next.run });
    recovered.push(next.run);
  }
  return recovered;
}

function heartbeat(deps: RunnerDeps, now: number, holderId: string): void {
  for (const id of deps.store.list()) {
    const snapshot = deps.store.load(id);
    if (snapshot === null || snapshot.meta.leaseScopeHash === null) continue;
    const lease = deps.store.loadLease(snapshot.meta.leaseScopeHash);
    if (lease === null || lease.holderId !== holderId) continue;
    if (lease.expiresAt > now) renewLease(deps.store, lease, now);
  }
}

export type { ProductionRunner, StepReceipt };
