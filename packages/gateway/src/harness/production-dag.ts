import type {
  ProductionBeat, ProductionSession, ProductionUnit, UnitBase, UnitKind,
} from "./production-types.js";

function assertNever(value: never): never {
  throw new Error(String(value));
}

export function chapterOrder(beats: readonly ProductionBeat[]): readonly string[] {
  const ids: string[] = [];
  for (const beat of beats) {
    if (!ids.includes(beat.chapterId)) ids.push(beat.chapterId);
  }
  return ids;
}

export function previousChapter(order: readonly string[], chapterId: string): string | null {
  const index = order.indexOf(chapterId);
  if (index <= 0) return null;
  const previous = order[index - 1];
  return previous === undefined ? null : previous;
}

export function unitBase(unit: ProductionUnit): UnitBase {
  return {
    id: unit.id, kind: unit.kind, dependencyHashes: unit.dependencyHashes, dependencyUnitIds: unit.dependencyUnitIds,
    ...(unit.chapterId === undefined ? {} : { chapterId: unit.chapterId }),
    ...(unit.sceneId === undefined ? {} : { sceneId: unit.sceneId }),
    ...(unit.lineIds === undefined ? {} : { lineIds: unit.lineIds }),
  };
}

export function pendingUnit(base: UnitBase): ProductionUnit {
  return { ...base, status: "pending" };
}

export function readyHashes(units: readonly ProductionUnit[]): ReadonlySet<string> {
  const hashes = new Set<string>();
  for (const unit of units) {
    if (unit.status === "ready") hashes.add(unit.outputHash);
  }
  return hashes;
}

export function executableUnitIds(session: ProductionSession): readonly string[] {
  if (session.initialScope === "imported-draft") return [];
  const ready = readyHashes(session.units);
  const order = chapterOrder(session.beats);
  const approved = new Set(session.chapterApprovals.map(row => row.chapterId));
  const ids: string[] = [];
  for (const unit of session.units) {
    if (unit.status !== "pending") continue;
    if (!unit.dependencyHashes.every(hash => ready.has(hash))) continue;
    switch (unit.kind) {
      case "outline":
        if (session.initialScope === "plan") ids.push(unit.id);
        break;
      case "scene-repair":
        if (session.initialScope === "edit") ids.push(unit.id);
        break;
      case "scene-draft": case "validation": case "image": case "proposal": {
        if (session.initialScope !== "plan" || !session.planApproved) break;
        if (unit.kind === "proposal") {
          if (approved.size !== order.length || order.some(id => !approved.has(id))) break;
          ids.push(unit.id);
          break;
        }
        if (unit.chapterId !== undefined) {
          const previous = previousChapter(order, unit.chapterId);
          if (previous !== null && !approved.has(previous)) break;
        }
        ids.push(unit.id);
        break;
      }
      default: return assertNever(unit.kind);
    }
  }
  return ids;
}

export function authorizeUnitKind(session: ProductionSession, kind: UnitKind): boolean {
  switch (kind) {
    case "outline": return session.initialScope === "plan";
    case "scene-repair": return session.initialScope === "edit";
    case "scene-draft": case "image": case "validation": case "proposal":
      return session.initialScope === "plan" && session.planApproved;
    default: return assertNever(kind);
  }
}

export function replaceUnit(units: readonly ProductionUnit[], next: ProductionUnit): readonly ProductionUnit[] {
  return units.map(unit => unit.id === next.id ? next : unit);
}

export function buildChapterUnits(session: ProductionSession): readonly ProductionUnit[] {
  const outline = session.units.find(unit => unit.kind === "outline");
  if (outline === undefined) return session.units;
  const outlineHash = session.hasher.hash(`unit:${outline.id}`);
  const built: ProductionUnit[] = [...session.units];
  let previousValidationHash: string | null = null;
  let previousValidationId: string | null = null;
  for (const chapterId of chapterOrder(session.beats)) {
    const draftIds: string[] = [];
    const draftHashes: string[] = [];
    const predecessorHashes = previousValidationHash === null ? [outlineHash] : [outlineHash, previousValidationHash];
    const predecessorIds = previousValidationId === null ? [outline.id] : [outline.id, previousValidationId];
    for (const beat of session.beats.filter(row => row.chapterId === chapterId)) {
      const id = session.ids.uuid();
      built.push(pendingUnit({
        id, kind: "scene-draft", dependencyHashes: predecessorHashes, dependencyUnitIds: predecessorIds,
        chapterId, sceneId: beat.id,
      }));
      draftIds.push(id);
      draftHashes.push(session.hasher.hash(`unit:${id}`));
    }
    const validationId = session.ids.uuid();
    built.push(pendingUnit({
      id: validationId, kind: "validation", dependencyHashes: draftHashes, dependencyUnitIds: draftIds, chapterId,
    }));
    previousValidationHash = session.hasher.hash(`unit:${validationId}`);
    previousValidationId = validationId;
  }
  return built;
}

export function invalidateDownstream(session: ProductionSession, chapterId: string): readonly ProductionUnit[] {
  const order = chapterOrder(session.beats);
  const index = order.indexOf(chapterId);
  const validation = session.units.find(unit => unit.kind === "validation" && unit.chapterId === chapterId);
  return session.units.map(unit => {
    if (unit.status === "blocked") return unit;
    const chapterIndex = unit.chapterId === undefined ? -1 : order.indexOf(unit.chapterId);
    const depends = validation !== undefined && unit.dependencyUnitIds.includes(validation.id);
    if (!depends && !(chapterIndex > index)) return unit;
    if (unit.kind === "scene-draft" && unit.chapterId === chapterId) return unit;
    return { ...unitBase(unit), status: "blocked" as const, reason: "rejected-predecessor" };
  });
}
