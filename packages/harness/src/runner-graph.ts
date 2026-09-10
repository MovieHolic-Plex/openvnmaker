import { assertNever } from "./primitives.js";
import type { Unit } from "./lifecycle-contracts.js";

export function unitOutputHash(unit: Unit): string | null {
  switch (unit.status) {
    case "ready": return unit.provenance.outputArtifactHash;
    case "pending": case "running": case "failed": case "cancelled": case "blocked": return null;
    default: return assertNever(unit);
  }
}

export function selectNextUnit(units: readonly Unit[], scopeUnitIds: readonly string[]): Unit | null {
  const ready = new Set<string>();
  for (const unit of units) {
    const hash = unitOutputHash(unit);
    if (hash !== null) ready.add(hash);
  }
  const scope = new Set(scopeUnitIds);
  for (const unit of units) {
    if (!scope.has(unit.id)) continue;
    switch (unit.status) {
      case "pending": break;
      case "running": case "ready": case "failed": case "cancelled": case "blocked": continue;
      default: return assertNever(unit);
    }
    if (unit.dependencyHashes.every(hash => ready.has(hash))) return unit;
  }
  return null;
}

export function scopedReady(units: readonly Unit[], scopeUnitIds: readonly string[]): boolean {
  const scope = new Set(scopeUnitIds);
  let counted = 0;
  for (const unit of units) {
    if (!scope.has(unit.id)) continue;
    counted += 1;
    switch (unit.status) {
      case "ready": break;
      case "pending": case "running": case "failed": case "cancelled": case "blocked": return false;
      default: return assertNever(unit);
    }
  }
  return counted > 0;
}

export function hasUnknownBlock(units: readonly Unit[], scopeUnitIds: readonly string[]): boolean {
  const scope = new Set(scopeUnitIds);
  for (const unit of units) {
    if (!scope.has(unit.id)) continue;
    switch (unit.status) {
      case "blocked": if (unit.reason === "unknown-effect") return true; break;
      case "pending": case "running": case "ready": case "failed": case "cancelled": break;
      default: return assertNever(unit);
    }
  }
  return false;
}
