import { lineAllowed, parseScript, type Scene, type VnScript } from "@vnmaker/content";
import { assertNever, type PreviewBoundary, type PreviewSnapshot } from "@vnmaker/harness";
import { reduce } from "../../engine/reducer.js";
import { findScene, initialState, type HistoryEntry, type VnAction, type VnState } from "../../engine/types.js";

export type PreviewPending =
  | { readonly kind: "choice"; readonly boundary: PreviewBoundary; readonly index: number }
  | { readonly kind: "exit"; readonly boundary: PreviewBoundary };

export type PreviewPlayState = {
  readonly state: VnState;
  readonly pending: PreviewPending | null;
};

export function previewSaveScope(snapshot: PreviewSnapshot): string {
  return `candidate:${snapshot.projectId}:${snapshot.snapshotHash}`;
}

export function rejectPreviewExport(): { readonly ok: false; readonly code: "PREVIEW_NOT_RELEASE" } {
  return { ok: false, code: "PREVIEW_NOT_RELEASE" };
}

export function scriptFromPreview(snapshot: PreviewSnapshot, title: string): VnScript {
  const first = snapshot.materializedScenes[0];
  const start = snapshot.entry.kind === "from-start" ? snapshot.entry.sceneId : first?.id ?? snapshot.entry.sceneId;
  return parseScript({
    title, subtitle: "", start, characters: snapshot.cast, flags: { ...snapshot.initialFlags },
    scenes: snapshot.materializedScenes,
  });
}

export function bootPreview(script: VnScript, snapshot: PreviewSnapshot): PreviewPlayState {
  const started = reduce(script, initialState(script), { type: "start" });
  switch (snapshot.entry.kind) {
    case "from-start":
      return { state: started, pending: null };
    case "assumed-state":
      return {
        state: reduce(script, started, {
          type: "restore", sceneId: snapshot.entry.sceneId, lineIndex: 0, affection: 0, flags: snapshot.entry.flags,
        }),
        pending: null,
      };
    default:
      return assertNever(snapshot.entry);
  }
}

function nextVisible(scene: Scene, start: number, flags: VnState["flags"]): number {
  for (let index = start; index < scene.lines.length; index += 1) {
    const line = scene.lines[index];
    if (line !== undefined && lineAllowed(line, flags)) return index;
  }
  return -1;
}

function lineEntry(scene: Scene, index: number): HistoryEntry | null {
  const line = scene.lines[index];
  if (line === undefined) return null;
  return { speaker: line.speaker ?? null, text: line.text, sceneId: scene.id, chapter: scene.chapter || scene.id };
}

function appendVisible(scene: Scene, from: number, until: number, flags: VnState["flags"], history: readonly HistoryEntry[]): readonly HistoryEntry[] {
  const extra: HistoryEntry[] = [];
  for (let index = from; index <= until && index < scene.lines.length; index += 1) {
    const line = scene.lines[index];
    if (line === undefined || !lineAllowed(line, flags)) continue;
    const entry = lineEntry(scene, index);
    if (entry !== null) extra.push(entry);
  }
  return [...history, ...extra];
}

function matchBoundary(
  boundaries: readonly PreviewBoundary[], fromSceneId: string, targetSceneId: string, choiceId?: string,
): PreviewBoundary | null {
  for (const boundary of boundaries) {
    if (boundary.fromSceneId !== fromSceneId || boundary.targetSceneId !== targetSceneId) continue;
    if (choiceId === undefined && boundary.choiceId === undefined) return boundary;
    if (choiceId !== undefined && boundary.choiceId === choiceId) return boundary;
  }
  return null;
}

function exitBoundary(scene: Scene, boundaries: readonly PreviewBoundary[]): PreviewBoundary | null {
  if (scene.choices?.length || scene.ending) return null;
  if (scene.next === undefined) return null;
  return matchBoundary(boundaries, scene.id, scene.next);
}

function freezeExit(state: VnState, scene: Scene, pending: PreviewPending, history: readonly HistoryEntry[]): PreviewPlayState {
  return {
    state: { ...state, phase: "scene", sceneId: scene.id, lineIndex: Math.max(0, scene.lines.length - 1), history, error: null },
    pending,
  };
}

export function applyPreviewAction(
  script: VnScript, play: PreviewPlayState, action: VnAction, boundaries: readonly PreviewBoundary[],
): PreviewPlayState {
  if (play.pending !== null) return play;
  switch (action.type) {
    case "choose": {
      if (play.state.phase !== "choice") return { state: reduce(script, play.state, action), pending: null };
      const scene = findScene(script, play.state.sceneId);
      const choice = scene?.choices?.[action.index];
      if (scene === null || choice === undefined) return { state: reduce(script, play.state, action), pending: null };
      const boundary = matchBoundary(boundaries, scene.id, choice.next, choice.id);
      if (boundary === null) return { state: reduce(script, play.state, action), pending: null };
      return { state: play.state, pending: { kind: "choice", boundary, index: action.index } };
    }
    case "advance":
    case "skipScene": {
      if (play.state.phase !== "scene") return { state: reduce(script, play.state, action), pending: null };
      const scene = findScene(script, play.state.sceneId);
      if (scene === null) return { state: reduce(script, play.state, action), pending: null };
      const leaving = action.type === "skipScene" || nextVisible(scene, play.state.lineIndex + 1, play.state.flags) < 0;
      if (!leaving) return { state: reduce(script, play.state, action), pending: null };
      const boundary = exitBoundary(scene, boundaries);
      if (boundary === null) return { state: reduce(script, play.state, action), pending: null };
      const last = scene.lines.length - 1;
      const until = action.type === "skipScene" ? last : play.state.lineIndex;
      return freezeExit(play.state, scene, { kind: "exit", boundary }, appendVisible(scene, play.state.lineIndex, until, play.state.flags, play.state.history));
    }
    case "start":
    case "restore":
    case "backToTitle":
      return { state: reduce(script, play.state, action), pending: null };
    default:
      return assertNever(action);
  }
}

export function restorePreviewBoundary(play: PreviewPlayState): PreviewPlayState {
  return { state: play.state, pending: null };
}
