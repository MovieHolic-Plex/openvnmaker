import { admitBudget } from "./budget.js";
import { budgetRequestSchema } from "./budget-contracts.js";
import { canonicalHash } from "./canonical.js";
import { parseEffect } from "./parsers.js";
import { assertNever, HarnessError, hashSchema, uuidSchema } from "./primitives.js";
import type { Effect, Run, Unit } from "./lifecycle-contracts.js";
import { hasUnknownBlock, scopedReady, selectNextUnit } from "./runner-graph.js";
import { isLiveLease } from "./runner-lease.js";
import { providerDispatchResultSchema, stepReceiptSchema } from "./runner-contracts.js";
import type { ProviderDispatchRequest, RunnerSnapshot, StepReceipt } from "./runner-contracts.js";
import type { CommandContext } from "./runner-commands.js";
import {
  blockedUnit, bumpRun, bumpSeq, cancelledUnit, chapterAttempts, effectCore, failedUnit, pauseFromAdmission,
  readyUnit, replaceUnit, reserveFor, runningUnit, stopForState, withReservation,
} from "./runner-util.js";
import { interruptSnapshot } from "./runner-recover.js";

function load(ctx: CommandContext, runId: string): RunnerSnapshot {
  const snapshot = ctx.deps.store.load(runId);
  if (snapshot === null) throw new HarnessError("INVALID_STATE");
  return snapshot;
}

function ownerOf(ctx: CommandContext, snapshot: RunnerSnapshot): RunnerSnapshot {
  if (snapshot.run.budgetOwnerRunId === snapshot.run.id) return snapshot;
  return load(ctx, snapshot.run.budgetOwnerRunId);
}

function emitStep(ctx: CommandContext, run: Run, receipt: StepReceipt): StepReceipt {
  ctx.emit({ type: "state", run });
  ctx.emit({ type: "step", receipt });
  return receipt;
}

function receipt(unitId: string | null, effectId: string | null, dispatched: number, stopReason: StepReceipt["stopReason"]): StepReceipt {
  return stepReceiptSchema.parse({ unitId, effectId, dispatched, stopReason });
}

export async function pumpRun(ctx: CommandContext, runId: string): Promise<StepReceipt> {
  const snapshot = load(ctx, runId);
  switch (snapshot.run.state.status) {
    case "running": break;
    default: return emitStep(ctx, snapshot.run, receipt(null, null, 0, stopForState(snapshot.run.state)));
  }
  const scope = snapshot.meta.leaseScopeHash;
  const lease = scope === null ? null : ctx.deps.store.loadLease(scope);
  if (lease === null || !isLiveLease(lease, ctx.deps.clock.now(), ctx.holderId, snapshot.run.ownerEpoch)) {
    const interrupted = interruptSnapshot(snapshot);
    ctx.deps.store.save(interrupted);
    return emitStep(ctx, interrupted.run, receipt(null, null, 0, "paused-interrupted"));
  }
  if (hasUnknownBlock(snapshot.run.units, snapshot.meta.scopeUnitIds)) {
    const paused = { ...snapshot, run: bumpRun(snapshot.run, { status: "paused", reason: "unknown-effect" }) };
    ctx.deps.store.save(paused);
    return emitStep(ctx, paused.run, receipt(null, null, 0, "paused-unknown-effect"));
  }
  const unit = selectNextUnit(snapshot.run.units, snapshot.meta.scopeUnitIds);
  if (unit === null) {
    if (scopedReady(snapshot.run.units, snapshot.meta.scopeUnitIds)) {
      const next = { ...snapshot, run: bumpRun(snapshot.run, { status: "awaiting-review" }) };
      ctx.deps.store.save(next);
      return emitStep(ctx, next.run, receipt(null, null, 0, "awaiting-review"));
    }
    return emitStep(ctx, snapshot.run, receipt(null, null, 0, "fenced"));
  }
  return dispatchUnit(ctx, snapshot, unit);
}

async function dispatchUnit(ctx: CommandContext, snapshot: RunnerSnapshot, unit: Unit): Promise<StepReceipt> {
  const owner = ownerOf(ctx, snapshot);
  const payloadHash = await canonicalHash({ runId: snapshot.run.id, unitId: unit.id, kind: unit.kind, deps: unit.dependencyHashes });
  const capabilityBindingHash = snapshot.meta.capabilityBindingHash;
  const counter = await ctx.deps.counter.count({ requestPayloadHash: payloadHash, capabilityBindingHash });
  const reserve = reserveFor(unit.kind);
  const request = budgetRequestSchema.parse({
    requestPayloadHash: payloadHash, capabilityBindingHash, budgetGroupId: snapshot.run.budgetGroupId,
    limitVersion: owner.run.limitVersion, textContextBytes: 1024, wireBodyBytes: 1024, images: [],
    requestedOutputTokens: Math.min(8192, snapshot.run.limits.request.maxOutputTokens),
    counter, capability: ctx.deps.capability, limits: snapshot.run.limits, policy: snapshot.run.tokenPolicy,
    boundedPayloadApproved: snapshot.meta.boundedPayloadApproved, unitAuthorized: true,
    used: { run: owner.used.run, chapter: chapterAttempts(owner, snapshot.meta.chapterId) },
    reserve, autoRepairRound: unit.autoRepairRound,
  });
  const admission = admitBudget(request);
  if (!admission.allowed) {
    const reason = pauseFromAdmission(admission.reason ?? "CAPABILITY_REQUIRED");
    const paused = { ...snapshot, run: bumpRun(snapshot.run, { status: "paused", reason }) };
    ctx.deps.store.save(paused);
    return emitStep(ctx, paused.run, receipt(unit.id, null, 0, stopForState(paused.run.state)));
  }
  const effectId = uuidSchema.parse(ctx.deps.ids.uuid());
  const intent = parseEffect({ effectId, payloadHash, admission, state: "intent" });
  const reservedOwner = withReservation(owner, snapshot.meta.chapterId, reserve);
  const withIntent: RunnerSnapshot = snapshot.run.id === owner.run.id
    ? { ...reservedOwner, effects: [...snapshot.effects, intent], run: bumpSeq(reservedOwner.run) }
    : { ...snapshot, effects: [...snapshot.effects, intent], run: bumpSeq(snapshot.run) };
  if (snapshot.run.id !== owner.run.id) ctx.deps.store.save({ ...reservedOwner, run: bumpSeq(reservedOwner.run) });
  ctx.deps.store.save(withIntent);
  ctx.emit({ type: "effect", effect: intent });
  const fresh = load(ctx, snapshot.run.id);
  if (fresh.run.state.status === "cancelled") {
    return emitStep(ctx, fresh.run, receipt(unit.id, effectId, 0, "fenced"));
  }
  const controller = new AbortController();
  ctx.setAbort(snapshot.run.id, controller);
  const requestDispatch: ProviderDispatchRequest = {
    effectId, unitId: unit.id, runId: snapshot.run.id, payloadHash, admission, kind: unit.kind, signal: controller.signal,
  };
  ctx.emit({ type: "dispatch-barrier", effectId, unitId: unit.id });
  if (ctx.deps.beforeDispatch) await ctx.deps.beforeDispatch(requestDispatch);
  const gated = load(ctx, snapshot.run.id);
  if (gated.run.state.status === "cancelled") {
    return emitStep(ctx, gated.run, receipt(unit.id, effectId, 0, "fenced"));
  }
  const epoch = gated.run.ownerEpoch;
  const dispatched = parseEffect({ ...effectCore(intent), state: "dispatched" });
  const running = {
    ...gated, effects: gated.effects.map(row => row.effectId === effectId ? dispatched : row),
    run: bumpSeq(gated.run, replaceUnit(gated.run.units, runningUnit(unit))),
  };
  ctx.deps.store.save(running);
  ctx.emit({ type: "effect", effect: dispatched });
  const raw = await ctx.deps.dispatch.dispatch(requestDispatch);
  const result = providerDispatchResultSchema.parse(raw);
  return finishDispatch(ctx, snapshot.run.id, unit, dispatched, result, epoch);
}

function finishDispatch(
  ctx: CommandContext, runId: string, unit: Unit, dispatched: Effect, result: ReturnType<typeof providerDispatchResultSchema.parse>, epoch: number,
): StepReceipt {
  const snapshot = load(ctx, runId);
  const fenced = snapshot.run.state.status === "cancelled" || snapshot.run.ownerEpoch !== epoch;
  const published = publish(dispatched, result);
  let units = snapshot.run.units;
  let state = snapshot.run.state;
  let stop: StepReceipt["stopReason"] = "unit-ready";
  if (fenced) {
    units = replaceUnit(units, cancelledUnit(unit));
    stop = "cancelled";
  } else {
    switch (result.kind) {
      case "succeeded":
        units = replaceUnit(units, readyUnit(unit, {
          originHead: snapshot.run.sourceHead, inputContentHash: unit.contextManifest.inputContentHash,
          readSet: unit.contextManifest.readSet, writeSet: [], outputArtifactHash: hashSchema.parse(result.artifact.hash),
          modelBindingHash: snapshot.meta.capabilityBindingHash,
          referenceBindingHashes: unit.contextManifest.referenceBindingHashes,
        }));
        stop = "unit-ready";
        break;
      case "known-failed":
        units = replaceUnit(units, failedUnit(unit, result.code));
        stop = "unit-failed";
        break;
      case "unknown":
        units = replaceUnit(units, blockedUnit(unit, "unknown-effect"));
        state = { status: "paused", reason: "unknown-effect" };
        stop = "paused-unknown-effect";
        break;
      case "auth":
        units = replaceUnit(units, failedUnit(unit, "AUTH_REQUIRED"));
        state = { status: "paused", reason: "auth" };
        stop = "paused-auth";
        break;
      case "quota":
        units = replaceUnit(units, failedUnit(unit, "QUOTA"));
        state = { status: "paused", reason: "quota" };
        stop = "paused-quota";
        break;
      case "capability":
        units = replaceUnit(units, failedUnit(unit, "CAPABILITY_REQUIRED"));
        state = { status: "paused", reason: "capability" };
        stop = "paused-capability";
        break;
      case "context-limit":
        units = replaceUnit(units, failedUnit(unit, "CONTEXT_LIMIT"));
        state = { status: "paused", reason: "capability" };
        stop = "paused-capability";
        break;
      default: return assertNever(result);
    }
  }
  const run = state.status === snapshot.run.state.status
    ? bumpSeq(snapshot.run, units)
    : bumpRun(snapshot.run, state, units);
  const next = { ...snapshot, run, effects: snapshot.effects.map(row => row.effectId === dispatched.effectId ? published : row) };
  ctx.deps.store.save(next);
  ctx.emit({ type: "effect", effect: published });
  return emitStep(ctx, next.run, receipt(unit.id, dispatched.effectId, 1, stop));
}

function publish(effect: Effect, result: ReturnType<typeof providerDispatchResultSchema.parse>): Effect {
  switch (result.kind) {
    case "succeeded":
      return parseEffect({ ...effectCore(effect), state: "succeeded", artifact: result.artifact, usage: result.usage });
    case "known-failed":
      return parseEffect({ ...effectCore(effect), state: "known-failed", code: result.code });
    case "unknown":
      return parseEffect({ ...effectCore(effect), state: "unknown", reason: result.reason });
    case "auth":
      return parseEffect({ ...effectCore(effect), state: "known-failed", code: "AUTH_REQUIRED" });
    case "quota":
      return parseEffect({ ...effectCore(effect), state: "known-failed", code: "QUOTA" });
    case "capability":
      return parseEffect({ ...effectCore(effect), state: "known-failed", code: "CAPABILITY_REQUIRED" });
    case "context-limit":
      return parseEffect({ ...effectCore(effect), state: "known-failed", code: "CONTEXT_LIMIT" });
    default: return assertNever(result);
  }
}
