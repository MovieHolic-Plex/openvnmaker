import {
  assertNever, durationLabel, pathRange, PRODUCTION_SCENE_LIMITS, validateOutlineDag,
  type CanonEntry, type OutlineDagFailure, type ProductionDocument, type ProductionOutline,
} from "@vnmaker/harness";

export type PlanScope = "source" | "candidate";
export type PlanOrigin = "generated" | "manual";
export type PlanDraftUnit = {
  readonly unitId: string;
  readonly kind: "outline" | "scene-draft" | "scene-repair" | "image" | "validation" | "proposal";
  readonly sceneIds: readonly string[];
  readonly factIds: readonly string[];
  readonly status: "pending" | "ready" | "stale";
};
export type PlanValidationReason = "SCENE_LIMIT" | "INVALID_CANON" | OutlineDagFailure;
export type PlanGateReason = PlanValidationReason | "stale-candidate" | "no-candidate";
export type PlanValidation = { readonly ok: true } | { readonly ok: false; readonly reason: PlanValidationReason };
export type PathDurationView = {
  readonly minMinutes: number | null;
  readonly maxMinutes: number | null;
  readonly label: string;
  readonly summedMinutes: number;
};
export type PlanSession = {
  readonly projectId: string;
  readonly sourceRevision: number;
  readonly sourceDocument: ProductionDocument;
  readonly candidateRevision: number | null;
  readonly candidateDocument: ProductionDocument | null;
  readonly candidateBaseRevision: number | null;
  readonly planApproved: boolean;
  readonly units: readonly PlanDraftUnit[];
  readonly proposalBaseRevision: number | null;
};
export type PlanSessionEvent =
  | { readonly kind: "edit"; readonly scope: PlanScope; readonly document: ProductionDocument }
  | { readonly kind: "apply-generated"; readonly scope: PlanScope; readonly document: ProductionDocument }
  | { readonly kind: "approve-candidate" };
export type PlanSessionResult =
  | { readonly ok: true; readonly session: PlanSession }
  | { readonly ok: false; readonly reason: PlanGateReason; readonly session: PlanSession };
export type PlanContextView = {
  readonly sourceIds: readonly string[];
  readonly omitted: readonly { readonly id: string; readonly reason: string }[];
};
export type PlanProjects = {
  readonly get: (projectId: string) => PlanSession | undefined;
  readonly set: (session: PlanSession) => void;
};

export function canonEntries(document: ProductionDocument): readonly CanonEntry[] {
  return [...document.castCanon, ...document.worldTimeline, ...document.branchFacts, ...document.artDirection];
}

export function validateAuthoredPlan(document: ProductionDocument, origin: PlanOrigin): PlanValidation {
  void origin;
  if (document.outline.scenes.length > PRODUCTION_SCENE_LIMITS.max) return { ok: false, reason: "SCENE_LIMIT" };
  if (document.outline.scenes.length > 0) {
    const dag = validateOutlineDag(document.outline);
    if (dag.kind === "blocked") return { ok: false, reason: dag.reason };
  }
  const ids = new Set(canonEntries(document).map(entry => entry.id));
  for (const entry of canonEntries(document)) {
    if (entry.relatedEntryIds.some(id => !ids.has(id))) return { ok: false, reason: "INVALID_CANON" };
    const truth = entry.truth;
    if (truth === undefined) continue;
    switch (truth.kind) {
      case "world": case "rumour": break;
      case "belief": if (truth.holderCharacterId.trim().length === 0) return { ok: false, reason: "INVALID_CANON" }; break;
      default: return assertNever(truth);
    }
  }
  return { ok: true };
}

export function pathDurationView(outline: ProductionOutline): PathDurationView {
  const weights = new Map(outline.scenes.map(scene => [scene.id, scene.targetMinutes]));
  const range = pathRange(outline.scenes.map(scene => ({
    id: scene.id,
    ...(scene.next === undefined ? {} : { next: scene.next }),
    ...(scene.choices === undefined ? {} : { choices: scene.choices.map(choice => ({ next: choice.next })) }),
    ...(scene.ending === undefined ? {} : { ending: scene.ending }),
  })), outline.start, weights);
  return {
    minMinutes: range.min, maxMinutes: range.max,
    label: durationLabel({ minMinutes: range.min, maxMinutes: range.max }),
    summedMinutes: outline.scenes.reduce((sum, scene) => sum + scene.targetMinutes, 0),
  };
}

export function createPlanSession(
  projectId: string, document: ProductionDocument, units: readonly PlanDraftUnit[] = [],
): PlanSession {
  return {
    projectId, sourceRevision: 0, sourceDocument: document, candidateRevision: null, candidateDocument: null,
    candidateBaseRevision: null, planApproved: false, units, proposalBaseRevision: 0,
  };
}

export function openCandidateSession(session: PlanSession): PlanSession {
  return {
    ...session, candidateRevision: 0, candidateDocument: session.sourceDocument,
    candidateBaseRevision: session.sourceRevision, planApproved: false,
  };
}

export function proposalConflicts(session: PlanSession): boolean {
  return session.proposalBaseRevision !== null && session.proposalBaseRevision !== session.sourceRevision;
}

export function canonChangeImpact(
  previous: ProductionDocument, next: ProductionDocument, units: readonly PlanDraftUnit[],
): { readonly changedEntryIds: readonly string[]; readonly affectedSceneIds: readonly string[]; readonly staleUnitIds: readonly string[] } {
  const before = new Map(canonEntries(previous).map(entry => [entry.id, entry]));
  const changedEntryIds: string[] = [];
  const scenes = new Set<string>();
  for (const entry of canonEntries(next)) {
    const prior = before.get(entry.id);
    if (prior !== undefined && JSON.stringify(prior) === JSON.stringify(entry)) continue;
    changedEntryIds.push(entry.id);
    for (const id of entry.sceneIds) scenes.add(id);
    if (prior !== undefined) for (const id of prior.sceneIds) scenes.add(id);
  }
  const staleUnitIds = units
    .filter(unit => unit.factIds.some(id => changedEntryIds.includes(id)) || unit.sceneIds.some(id => scenes.has(id)))
    .map(unit => unit.unitId);
  return { changedEntryIds, affectedSceneIds: [...scenes].sort(), staleUnitIds };
}

export function planContextView(document: ProductionDocument, omittedIds: readonly string[] = []): PlanContextView {
  const hidden = new Set(omittedIds);
  return {
    sourceIds: [
      ...canonEntries(document).filter(entry => !hidden.has(entry.id)).map(entry => entry.id),
      ...document.outline.scenes.map(scene => scene.id),
    ],
    omitted: omittedIds.map(id => ({ id, reason: "omitted" })),
  };
}

export function createPlanProjects(): PlanProjects {
  const rows = new Map<string, PlanSession>();
  return { get: projectId => rows.get(projectId), set: session => { rows.set(session.projectId, session); } };
}

export function candidateApprovalGate(session: PlanSession): PlanValidation | { readonly ok: false; readonly reason: "stale-candidate" | "no-candidate" } {
  if (session.candidateDocument === null || session.candidateRevision === null || session.candidateBaseRevision === null) {
    return { ok: false, reason: "no-candidate" };
  }
  if (session.candidateBaseRevision !== session.sourceRevision) return { ok: false, reason: "stale-candidate" };
  return validateAuthoredPlan(session.candidateDocument, "manual");
}

function markStale(units: readonly PlanDraftUnit[], staleIds: readonly string[]): readonly PlanDraftUnit[] {
  const stale = new Set(staleIds);
  return units.map(unit => stale.has(unit.unitId) ? { ...unit, status: "stale" } : unit);
}

function commitDocument(
  session: PlanSession, scope: PlanScope, document: ProductionDocument, origin: PlanOrigin,
): PlanSessionResult {
  const check = validateAuthoredPlan(document, origin);
  if (!check.ok) return { ok: false, reason: check.reason, session };
  switch (scope) {
    case "source":
      return {
        ok: true,
        session: {
          ...session, sourceRevision: session.sourceRevision + 1, sourceDocument: document,
          units: markStale(session.units, canonChangeImpact(session.sourceDocument, document, session.units).staleUnitIds),
        },
      };
    case "candidate": {
      if (session.candidateDocument === null || session.candidateRevision === null) {
        return { ok: false, reason: "no-candidate", session };
      }
      return {
        ok: true,
        session: {
          ...session, candidateRevision: session.candidateRevision + 1, candidateDocument: document,
          units: markStale(session.units, canonChangeImpact(session.candidateDocument, document, session.units).staleUnitIds),
        },
      };
    }
    default: return assertNever(scope);
  }
}

export function reducePlanSession(session: PlanSession, event: PlanSessionEvent): PlanSessionResult {
  switch (event.kind) {
    case "edit": return commitDocument(session, event.scope, event.document, "manual");
    case "apply-generated": return commitDocument(session, event.scope, event.document, "generated");
    case "approve-candidate": {
      const gate = candidateApprovalGate(session);
      if (!gate.ok) return { ok: false, reason: gate.reason, session };
      return { ok: true, session: { ...session, planApproved: true } };
    }
    default: return assertNever(event);
  }
}

export function planFailureMessage(reason: PlanGateReason): string {
  switch (reason) {
    case "SCENE_LIMIT": return "장편 설계는 최대 80개 씬까지 입력할 수 있습니다.";
    case "INVALID_CANON": return "설정 항목의 참조나 믿음의 주체가 올바르지 않습니다.";
    case "START_NOT_FOUND": return "시작 씬을 설계에서 찾을 수 없습니다.";
    case "DUPLICATE_SCENE_ID": return "설계에 중복된 씬 ID가 있습니다.";
    case "DUPLICATE_CHOICE_ID": return "한 씬에 중복된 선택지 ID가 있습니다.";
    case "INVALID_SCENE_EXIT": return "각 씬에는 다음 씬·선택지·엔딩 중 하나의 출구가 필요합니다.";
    case "TARGET_NOT_FOUND": return "잘못된 분기입니다. 없는 씬으로 이어질 수 없습니다.";
    case "OUTLINE_CYCLE": return "설계에 반복 경로가 있습니다.";
    case "UNREACHABLE_SCENE": return "시작에서 도달할 수 없는 엔딩이나 씬은 승인할 수 없습니다.";
    case "stale-candidate": return "원본이 바뀐 오래된 후보는 승인할 수 없습니다.";
    case "no-candidate": return "후보 계획이 없습니다.";
    default: return assertNever(reason);
  }
}
