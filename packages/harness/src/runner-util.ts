import { z } from "zod";
import { pauseReasonSchema, RUN_TRANSITIONS } from "./lifecycle-contracts.js";
import { parseRun } from "./parsers.js";
import type { Effect, Run, RunState, RunStatus, Unit } from "./lifecycle-contracts.js";
import { attemptCountersSchema } from "./budget-contracts.js";
import { assertNever, HarnessError } from "./primitives.js";
import type { HarnessErrorCode } from "./primitives.js";
import type { RunnerSnapshot, StepStopReason } from "./runner-contracts.js";
import type { UnitProvenance } from "./reuse-contracts.js";

type AttemptCounters = z.infer<typeof attemptCountersSchema>;
type PauseReason = z.infer<typeof pauseReasonSchema>;

export const ZERO_ATTEMPTS: AttemptCounters = { textAttempts: 0, imageAttempts: 0, countRequests: 0 };

export function addAttempts(left: AttemptCounters, right: AttemptCounters): AttemptCounters {
  return {
    textAttempts: left.textAttempts + right.textAttempts,
    imageAttempts: left.imageAttempts + right.imageAttempts,
    countRequests: left.countRequests + right.countRequests,
  };
}

export function attemptsFit(used: AttemptCounters, limits: AttemptCounters): boolean {
  return used.textAttempts <= limits.textAttempts && used.imageAttempts <= limits.imageAttempts &&
    used.countRequests <= limits.countRequests;
}

export function chapterAttempts(snapshot: RunnerSnapshot, chapterId: string): AttemptCounters {
  for (const row of snapshot.used.chapters) if (row.chapterId === chapterId) return row.used;
  return ZERO_ATTEMPTS;
}

export function withReservation(snapshot: RunnerSnapshot, chapterId: string, reserve: AttemptCounters): RunnerSnapshot {
  const found = snapshot.used.chapters.some(row => row.chapterId === chapterId);
  const chapters = found
    ? snapshot.used.chapters.map(row => row.chapterId === chapterId ? { chapterId, used: addAttempts(row.used, reserve) } : row)
    : [...snapshot.used.chapters, { chapterId, used: reserve }];
  return { ...snapshot, used: { run: addAttempts(snapshot.used.run, reserve), chapters } };
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  for (const status of RUN_TRANSITIONS[from]) if (status === to) return;
  throw new HarnessError("INVALID_STATE");
}

export function bumpRun(run: Run, state: RunState, units: Run["units"] = run.units, extra: object = {}): Run {
  return parseRun({ ...run, ...extra, state, units, version: run.version + 1, lastEventSeq: run.lastEventSeq + 1 });
}

export function bumpSeq(run: Run, units: Run["units"] = run.units, extra: object = {}): Run {
  return parseRun({ ...run, ...extra, units, lastEventSeq: run.lastEventSeq + 1 });
}

function baseUnit(unit: Unit) {
  return {
    id: unit.id, kind: unit.kind, dependencyHashes: unit.dependencyHashes, contextManifest: unit.contextManifest,
    autoRepairRound: unit.autoRepairRound,
    ...(unit.repairFamilyId === undefined ? {} : { repairFamilyId: unit.repairFamilyId }),
  };
}

export function pendingUnit(unit: Unit): Unit { return { ...baseUnit(unit), status: "pending" }; }
export function runningUnit(unit: Unit): Unit { return { ...baseUnit(unit), status: "running" }; }
export function cancelledUnit(unit: Unit): Unit { return { ...baseUnit(unit), status: "cancelled" }; }
export function failedUnit(unit: Unit, code: HarnessErrorCode): Unit { return { ...baseUnit(unit), status: "failed", code }; }
export function blockedUnit(unit: Unit, reason: string): Unit { return { ...baseUnit(unit), status: "blocked", reason }; }
export function readyUnit(unit: Unit, provenance: UnitProvenance): Unit {
  return { ...baseUnit(unit), status: "ready", provenance };
}

export function replaceUnit(units: readonly Unit[], next: Unit): readonly Unit[] {
  return units.map(unit => unit.id === next.id ? next : unit);
}

export function effectCore(effect: Effect) {
  return {
    effectId: effect.effectId, payloadHash: effect.payloadHash, admission: effect.admission,
    ...(effect.replacesEffectId === undefined ? {} : { replacesEffectId: effect.replacesEffectId }),
  };
}

export function stopForState(state: RunState): StepStopReason {
  switch (state.status) {
    case "cancelled": return "fenced";
    case "idle": case "planned": return "idle";
    case "awaiting-review": return "awaiting-review";
    case "completed": return "completed";
    case "running": return "fenced";
    case "failed": return "unit-failed";
    case "paused":
      switch (state.reason) {
        case "auth": return "paused-auth";
        case "quota": return "paused-quota";
        case "capability": return "paused-capability";
        case "budget": return "paused-budget";
        case "interrupted": return "paused-interrupted";
        case "unknown-effect": return "paused-unknown-effect";
        case "validation": return "paused-validation";
        case "stale-source": return "paused-stale-source";
        case "user": return "paused-user";
        default: return assertNever(state.reason);
      }
    default: return assertNever(state);
  }
}

export function pauseFromAdmission(reason: string): PauseReason {
  if (reason === "AUTH_REQUIRED" || reason === "COUNTER_AUTH") return "auth";
  if (reason === "QUOTA" || reason === "COUNTER_QUOTA") return "quota";
  if (reason === "WRITE_SCOPE_DENIED") return "validation";
  if (reason.endsWith("_LIMIT") && reason !== "CONTEXT_LIMIT") return "budget";
  return "capability";
}

export function reserveFor(kind: Unit["kind"]): AttemptCounters {
  return kind === "image"
    ? { textAttempts: 0, imageAttempts: 1, countRequests: 0 }
    : { textAttempts: 1, imageAttempts: 0, countRequests: 0 };
}
