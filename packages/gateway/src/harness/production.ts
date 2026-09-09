import {
  authorizeUnitKind, buildChapterUnits, executableUnitIds, invalidateDownstream, pendingUnit,
  replaceUnit, unitBase,
} from "./production-dag.js";
import { applySelectedLines } from "./production-repair.js";
import type {
  CreateProductionInput, ProductionCastDraft, ProductionScene, ProductionSession, ProductionUnit, UnitOutput,
} from "./production-types.js";

export type {
  CreateProductionInput, ProductionBeat, ProductionCastDraft, ProductionCastMember, ProductionChoice,
  ProductionLine, ProductionScene, ProductionSession, ProductionUnit, ProposalGate, SourceHead, UnitKind, UnitOutput,
} from "./production-types.js";
export { authorizeUnitKind, executableUnitIds } from "./production-dag.js";
export { previewEligibleSceneIds, proposalGate, publicApplyDecision, publicExportDecision } from "./production-gates.js";

function assertApprovedSpeaker(session: ProductionSession, speaker: string | null): void {
  if (speaker === null || speaker === "me") return;
  if (!session.cast.some(member => member.id === speaker)) throw new Error("등록되지 않은 화자가 있습니다.");
}

function upsertScene(scenes: readonly ProductionScene[], scene: ProductionScene): readonly ProductionScene[] {
  return scenes.some(row => row.id === scene.id)
    ? scenes.map(row => row.id === scene.id ? scene : row)
    : [...scenes, scene];
}

function markReady(session: ProductionSession, unit: ProductionUnit, hash: string): ProductionUnit {
  return {
    ...unitBase(unit),
    status: "ready",
    outputHash: hash,
    provenance: {
      originHead: session.sourceHead,
      outputArtifactHash: hash,
      inputContentHash: session.hasher.hash(`input:${unit.id}`),
    },
  };
}

export function createProductionSession(input: CreateProductionInput): ProductionSession {
  const units = input.initialScope === "plan"
    ? [pendingUnit({ id: input.ids.uuid(), kind: "outline", dependencyHashes: [], dependencyUnitIds: [] })]
    : [];
  return {
    sourceHead: input.sourceHead,
    initialScope: input.initialScope,
    brief: input.brief,
    targetMinutes: input.targetMinutes,
    hasher: input.hasher,
    ids: input.ids,
    cast: input.scriptCast,
    beats: input.beats ?? [],
    scenes: input.scriptScenes,
    units,
    planApproved: input.initialScope === "edit",
    planApprovalHash: input.initialScope === "edit" ? input.hasher.hash("existing-plan") : null,
    chapterApprovals: [],
    assetApprovals: [],
    originalScenes: input.scriptScenes,
    originalBeats: input.beats ?? [],
  };
}

export function registerApprovedCast(
  session: ProductionSession, drafts: readonly ProductionCastDraft[],
): ProductionSession {
  return {
    ...session,
    cast: drafts.map(draft => ({ ...draft, id: session.ids.characterId() })),
  };
}

export function approvePlan(
  session: ProductionSession, input: { readonly beats: ProductionSession["beats"]; readonly hash: string },
): ProductionSession {
  if (session.initialScope !== "plan") throw new Error("REVIEW_REQUIRED");
  const next: ProductionSession = {
    ...session,
    beats: input.beats,
    planApproved: true,
    planApprovalHash: input.hash,
  };
  return { ...next, units: buildChapterUnits(next) };
}

export function approveReferenceArt(
  session: ProductionSession, binding: { readonly assetId: string; readonly hash: string },
): ProductionSession {
  return { ...session, assetApprovals: [...session.assetApprovals, binding] };
}

export function approveChapter(session: ProductionSession, chapterId: string, hash: string): ProductionSession {
  const drafts = session.units.filter(unit => unit.chapterId === chapterId && unit.kind === "scene-draft");
  if (drafts.length === 0 || drafts.some(unit => unit.status !== "ready")) throw new Error("REVIEW_REQUIRED");
  if (session.chapterApprovals.some(row => row.chapterId === chapterId)) return session;
  return { ...session, chapterApprovals: [...session.chapterApprovals, { chapterId, hash }] };
}

export function rejectChapter(session: ProductionSession, chapterId: string): ProductionSession {
  return {
    ...session,
    chapterApprovals: session.chapterApprovals.filter(row => row.chapterId !== chapterId),
    units: invalidateDownstream(session, chapterId),
  };
}

export function startSelectionRepair(
  session: ProductionSession,
  selection: { readonly sceneId: string; readonly lineIds: readonly string[]; readonly instruction: string },
): ProductionSession {
  if (session.initialScope !== "edit") throw new Error("REVIEW_REQUIRED");
  const scene = session.scenes.find(row => row.id === selection.sceneId);
  if (scene === undefined) throw new Error("STALE_TARGET");
  void selection.instruction;
  const unit = pendingUnit({
    id: session.ids.uuid(), kind: "scene-repair", dependencyHashes: [], dependencyUnitIds: [],
    chapterId: scene.chapterId, sceneId: scene.id, lineIds: selection.lineIds,
  });
  return { ...session, units: [...session.units, unit] };
}

export function completeUnit(session: ProductionSession, unitId: string, output: UnitOutput): ProductionSession {
  const unit = session.units.find(row => row.id === unitId);
  if (unit === undefined || unit.status !== "pending") throw new Error("INVALID_STATE");
  if (!executableUnitIds(session).includes(unitId)) throw new Error("REVIEW_REQUIRED");
  if (!authorizeUnitKind(session, unit.kind) && unit.kind !== "outline" && unit.kind !== "scene-repair") {
    throw new Error("REVIEW_REQUIRED");
  }
  switch (unit.kind) {
    case "scene-draft": {
      if (output.scene === undefined) throw new Error("INVALID_INPUT");
      for (const line of output.scene.lines) assertApprovedSpeaker(session, line.speaker);
      return {
        ...session,
        scenes: upsertScene(session.scenes, output.scene),
        units: replaceUnit(session.units, markReady(session, unit, output.hash)),
      };
    }
    case "scene-repair": {
      if (output.lines === undefined || unit.sceneId === undefined || unit.lineIds === undefined) {
        throw new Error("INVALID_INPUT");
      }
      const scene = session.scenes.find(row => row.id === unit.sceneId);
      if (scene === undefined) throw new Error("STALE_TARGET");
      for (const line of output.lines) assertApprovedSpeaker(session, line.speaker);
      return {
        ...session,
        scenes: upsertScene(session.scenes, applySelectedLines(scene, unit.lineIds, output.lines)),
        units: replaceUnit(session.units, markReady(session, unit, output.hash)),
      };
    }
    case "outline": case "validation": case "image": case "proposal":
      return { ...session, units: replaceUnit(session.units, markReady(session, unit, output.hash)) };
  }
}
