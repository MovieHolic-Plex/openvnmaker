import { canonicalHash, canonicalJson } from "./canonical.js";
import { parseRun, parseRunCommand } from "./parsers.js";
import { assertNever, HarnessError, uuidSchema } from "./primitives.js";
import type { Run } from "./lifecycle-contracts.js";
import type { RunCommand } from "./command-contracts.js";
import { acquireLease } from "./runner-lease.js";
import type { RunnerDeps, RunnerEvent, RunnerSnapshot } from "./runner-contracts.js";
import { attemptsFit, assertTransition, bumpRun, pendingUnit } from "./runner-util.js";

export type CommandContext = {
  readonly deps: RunnerDeps;
  readonly holderId: string;
  readonly emit: (event: RunnerEvent) => void;
  readonly abort: (runId: string) => void;
  readonly setAbort: (runId: string, controller: AbortController) => void;
};

function mustLoad(deps: RunnerDeps, runId: string): RunnerSnapshot {
  const snapshot = deps.store.load(runId);
  if (snapshot === null) throw new HarnessError("INVALID_STATE");
  return snapshot;
}

type ControlCommand = Exclude<RunCommand, { action: "previews" }>;

async function commitCommand(
  ctx: CommandContext, runId: string, command: ControlCommand, mutate: (snapshot: RunnerSnapshot) => RunnerSnapshot | { parent: RunnerSnapshot; child: RunnerSnapshot },
): Promise<Run> {
  const hash = await canonicalHash(command);
  const receipt = ctx.deps.store.loadReceipt(command.requestId);
  if (receipt !== null) {
    if (receipt.payloadHash !== hash) throw new HarnessError("ID_PAYLOAD_CONFLICT");
    return receipt.snapshot.run;
  }
  return ctx.deps.store.transaction(() => {
    const snapshot = mustLoad(ctx.deps, runId);
    if (snapshot.run.version !== command.expectedRunVersion) throw new HarnessError("STALE_HEAD");
    const next = mutate(snapshot);
    if ("child" in next) {
      ctx.deps.store.save(next.parent);
      ctx.deps.store.save(next.child);
      ctx.deps.store.saveReceipt(command.requestId, hash, next.child);
      ctx.emit({ type: "state", run: next.child.run });
      return next.child.run;
    }
    ctx.deps.store.save(next);
    ctx.deps.store.saveReceipt(command.requestId, hash, next);
    ctx.emit({ type: "state", run: next.run });
    return next.run;
  });
}

export async function applyCommand(ctx: CommandContext, runId: string, input: unknown): Promise<Run> {
  const command = parseRunCommand(input);
  switch (command.action) {
    case "start": return commitCommand(ctx, runId, command, snapshot => startRun(ctx, snapshot, command));
    case "cancel": return commitCommand(ctx, runId, command, snapshot => cancelRun(ctx, snapshot));
    case "resume": return commitCommand(ctx, runId, command, snapshot => resumeRun(ctx, snapshot, command));
    case "pause": return commitCommand(ctx, runId, command, snapshot => pauseRun(snapshot, command.reason));
    case "budget": return commitCommand(ctx, runId, command, snapshot => budgetRun(snapshot, command));
    case "retry-effect": return commitCommand(ctx, runId, command, snapshot => retryEffect(snapshot, command));
    case "repropose": return commitCommand(ctx, runId, command, snapshot => reproposeRun(ctx, snapshot, command));
    case "approve": return commitCommand(ctx, runId, command, snapshot => approveRun(snapshot));
    case "request-changes": return commitCommand(ctx, runId, command, snapshot => requestChanges(ctx, snapshot, command));
    case "previews": throw new HarnessError("INVALID_STATE");
    default: return assertNever(command);
  }
}

function startRun(ctx: CommandContext, snapshot: RunnerSnapshot, command: Extract<RunCommand, { action: "start" }>): RunnerSnapshot {
  assertTransition(snapshot.run.state.status, "running");
  if (snapshot.run.state.status !== "idle") throw new HarnessError("INVALID_STATE");
  const scopeHash = snapshot.meta.leaseScopeHash;
  if (scopeHash === null) throw new HarnessError("RUNNER_UNAVAILABLE");
  const lease = acquireLease(ctx.deps.store, scopeHash, ctx.holderId, ctx.deps.clock.now());
  const run = bumpRun(snapshot.run, { status: "running" }, snapshot.run.units, {
    limits: command.limits, tokenPolicy: command.tokenPolicy, ownerEpoch: lease.epoch,
  });
  return {
    ...snapshot, run,
    meta: {
      ...snapshot.meta, scopeUnitIds: command.scope.unitIds,
      chapterId: command.scope.chapterIds[0] ?? "ch1",
      boundedPayloadApproved: command.tokenPolicy === "bounded-payload",
      leaseScopeHash: lease.scopeHash, holderId: lease.holderId,
    },
  };
}

function cancelRun(ctx: CommandContext, snapshot: RunnerSnapshot): RunnerSnapshot {
  switch (snapshot.run.state.status) {
    case "completed": case "failed": throw new HarnessError("INVALID_STATE");
    case "cancelled": return snapshot;
    case "planned": case "idle": case "running": case "awaiting-review": case "paused": break;
    default: return assertNever(snapshot.run.state);
  }
  assertTransition(snapshot.run.state.status, "cancelled");
  ctx.abort(snapshot.run.id);
  const units = snapshot.run.units.map(unit => {
    switch (unit.status) {
      case "running": case "pending": return { ...pendingUnit(unit), status: "cancelled" as const };
      case "ready": case "failed": case "cancelled": case "blocked": return unit;
      default: return assertNever(unit);
    }
  });
  return { ...snapshot, run: bumpRun(snapshot.run, { status: "cancelled" }, units, { ownerEpoch: snapshot.run.ownerEpoch + 1 }) };
}

function resumeRun(ctx: CommandContext, snapshot: RunnerSnapshot, command: Extract<RunCommand, { action: "resume" }>): RunnerSnapshot {
  if (snapshot.run.state.status !== "paused") throw new HarnessError("INVALID_STATE");
  assertTransition("paused", "running");
  if (canonicalJson(command.observedSourceHead) !== canonicalJson(snapshot.run.sourceHead)) throw new HarnessError("REPROPOSE_REQUIRED");
  if (command.capabilityBindingHash !== snapshot.meta.capabilityBindingHash) throw new HarnessError("CAPABILITY_REQUIRED");
  for (const effect of snapshot.effects) {
    switch (effect.state) {
      case "unknown": {
        const authorized = snapshot.meta.authorizedReplacements.some(id => id === effect.effectId);
        const replaced = snapshot.effects.some(row => row.replacesEffectId === effect.effectId);
        if (!authorized && !replaced) throw new HarnessError("UNKNOWN_EFFECT");
        break;
      }
      case "intent": case "dispatched": case "succeeded": case "known-failed": break;
      default: return assertNever(effect);
    }
  }
  const now = ctx.deps.clock.now();
  const scopeHash = snapshot.meta.leaseScopeHash;
  if (scopeHash === null) throw new HarnessError("RUNNER_UNAVAILABLE");
  const lease = acquireLease(ctx.deps.store, scopeHash, ctx.holderId, now);
  const units = snapshot.run.units.map(unit => {
    switch (unit.status) {
      case "failed": return pendingUnit(unit);
      case "pending": case "running": case "ready": case "cancelled": case "blocked": return unit;
      default: return assertNever(unit);
    }
  });
  return { ...snapshot, run: bumpRun(snapshot.run, { status: "running" }, units, { ownerEpoch: lease.epoch }) };
}

function pauseRun(snapshot: RunnerSnapshot, reason: "user" | "stale-source"): RunnerSnapshot {
  assertTransition(snapshot.run.state.status, "paused");
  if (snapshot.run.state.status !== "running") throw new HarnessError("INVALID_STATE");
  return { ...snapshot, run: bumpRun(snapshot.run, { status: "paused", reason }) };
}

function budgetRun(snapshot: RunnerSnapshot, command: Extract<RunCommand, { action: "budget" }>): RunnerSnapshot {
  switch (snapshot.run.state.status) {
    case "idle": case "awaiting-review": case "paused": case "completed": case "cancelled": case "failed": break;
    case "planned": case "running": throw new HarnessError("INVALID_STATE");
    default: return assertNever(snapshot.run.state);
  }
  if (snapshot.run.limitVersion !== command.expectedLimitVersion) throw new HarnessError("STALE_HEAD");
  if (!attemptsFit(snapshot.used.run, command.limits.run)) throw new HarnessError("LIMIT_EXCEEDED");
  for (const row of snapshot.used.chapters) {
    if (!attemptsFit(row.used, command.limits.chapter)) throw new HarnessError("LIMIT_EXCEEDED");
  }
  const run = bumpRun(snapshot.run, snapshot.run.state, snapshot.run.units, {
    limits: command.limits, tokenPolicy: command.tokenPolicy, limitVersion: snapshot.run.limitVersion + 1,
  });
  return { ...snapshot, run };
}

function retryEffect(snapshot: RunnerSnapshot, command: Extract<RunCommand, { action: "retry-effect" }>): RunnerSnapshot {
  if (snapshot.run.state.status !== "paused" || snapshot.run.state.reason !== "unknown-effect") {
    throw new HarnessError("INVALID_STATE");
  }
  const effect = snapshot.effects.find(row => row.effectId === command.effectId);
  if (effect === undefined || effect.state !== "unknown" || effect.payloadHash !== command.payloadHash) {
    throw new HarnessError("UNKNOWN_EFFECT");
  }
  if (snapshot.meta.authorizedReplacements.some(id => id === command.effectId)) {
    return { ...snapshot, run: bumpRun(snapshot.run, snapshot.run.state) };
  }
  return {
    ...snapshot,
    run: bumpRun(snapshot.run, snapshot.run.state),
    meta: { ...snapshot.meta, authorizedReplacements: [...snapshot.meta.authorizedReplacements, command.effectId] },
  };
}

function reproposeRun(ctx: CommandContext, snapshot: RunnerSnapshot, command: Extract<RunCommand, { action: "repropose" }>): { parent: RunnerSnapshot; child: RunnerSnapshot } {
  const childId = uuidSchema.parse(ctx.deps.ids.uuid());
  const candidateId = uuidSchema.parse(ctx.deps.ids.uuid());
  const units = snapshot.run.units.map(unit => {
    switch (unit.status) {
      case "ready": return unit;
      case "pending": case "running": case "failed": case "cancelled": case "blocked": return pendingUnit(unit);
      default: return assertNever(unit);
    }
  });
  const ownerId = snapshot.run.budgetOwnerRunId;
  const childRun = parseRun({
    ...snapshot.run, id: childId, version: 0, lastEventSeq: 0, ownerEpoch: 0,
    state: { status: "idle" }, units, proposalIds: [],
    sourceHead: command.newBaseHead,
    candidateRef: { candidateId, revision: 0 },
    budgetOwnerRunId: ownerId, budgetGroupId: snapshot.run.budgetGroupId,
  });
  const parent = { ...snapshot, run: bumpRun(snapshot.run, snapshot.run.state) };
  const child: RunnerSnapshot = {
    run: childRun,
    meta: { ...snapshot.meta, scopeUnitIds: [], authorizedReplacements: [], leaseScopeHash: snapshot.meta.leaseScopeHash },
    effects: [],
    used: { run: { textAttempts: 0, imageAttempts: 0, countRequests: 0 }, chapters: [] },
  };
  return { parent, child };
}

function approveRun(snapshot: RunnerSnapshot): RunnerSnapshot {
  assertTransition(snapshot.run.state.status, "idle");
  if (snapshot.run.state.status !== "awaiting-review") throw new HarnessError("INVALID_STATE");
  return { ...snapshot, run: bumpRun(snapshot.run, { status: "idle" }) };
}

function requestChanges(ctx: CommandContext, snapshot: RunnerSnapshot, command: Extract<RunCommand, { action: "request-changes" }>): RunnerSnapshot {
  const status = snapshot.run.state.status;
  const pausedValidation = status === "paused" && snapshot.run.state.reason === "validation";
  if (status !== "awaiting-review" && !pausedValidation) throw new HarnessError("INVALID_STATE");
  assertTransition(status, "running");
  const units = snapshot.run.units.map(unit => {
    switch (unit.status) {
      case "failed": return pendingUnit(unit);
      case "pending": case "running": case "ready": case "cancelled": case "blocked": return unit;
      default: return assertNever(unit);
    }
  });
  const now = ctx.deps.clock.now();
  const scopeHash = snapshot.meta.leaseScopeHash;
  if (scopeHash === null) throw new HarnessError("RUNNER_UNAVAILABLE");
  const lease = acquireLease(ctx.deps.store, scopeHash, ctx.holderId, now);
  return {
    ...snapshot,
    run: bumpRun(snapshot.run, { status: "running" }, units, {
      limits: command.limits, tokenPolicy: command.tokenPolicy, ownerEpoch: lease.epoch,
    }),
  };
}
