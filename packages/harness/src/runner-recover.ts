import { assertNever } from "./primitives.js";
import { parseEffect } from "./parsers.js";
import type { RunnerSnapshot } from "./runner-contracts.js";
import { bumpRun, effectCore, failedUnit } from "./runner-util.js";

export function interruptSnapshot(snapshot: RunnerSnapshot): RunnerSnapshot {
  const effects = snapshot.effects.map(effect => {
    switch (effect.state) {
      case "dispatched":
        return parseEffect({ ...effectCore(effect), state: "unknown", reason: "interrupted" });
      case "intent": case "succeeded": case "known-failed": case "unknown": return effect;
      default: return assertNever(effect);
    }
  });
  const units = snapshot.run.units.map(unit => {
    switch (unit.status) {
      case "running": return failedUnit(unit, "UPSTREAM");
      case "pending": case "ready": case "failed": case "cancelled": case "blocked": return unit;
      default: return assertNever(unit);
    }
  });
  return {
    ...snapshot, effects,
    run: bumpRun(snapshot.run, { status: "paused", reason: "interrupted" }, units, { ownerEpoch: snapshot.run.ownerEpoch + 1 }),
  };
}
