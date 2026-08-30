import type { Scene, VnScript } from "@vnmaker/content";
import { findScene, type HistoryEntry, type VnAction, type VnState } from "./types.js";

function lineOf(scene: Scene, index: number): HistoryEntry | null {
  const line = scene.lines[index];
  if (!line) return null;
  return { speaker: line.speaker ?? null, text: line.text };
}

function enterScene(script: VnScript, state: VnState, id: string): VnState {
  const scene = findScene(script, id);
  if (!scene) {
    return { ...state, error: `알 수 없는 씬 id: ${id}` };
  }
  return {
    ...state,
    phase: "scene",
    sceneId: id,
    lineIndex: 0,
    error: null,
    sceneEpoch: state.sceneEpoch + 1,
  };
}

/** 씬의 마지막 줄을 지난 뒤 어디로 갈지 결정한다. */
function leaveScene(script: VnScript, state: VnState, scene: Scene): VnState {
  if (scene.choices && scene.choices.length > 0) {
    return { ...state, phase: "choice" };
  }
  if (scene.ending) {
    return { ...state, phase: "ending", endingTitle: scene.ending };
  }
  if (scene.next) {
    return enterScene(script, state, scene.next);
  }
  return { ...state, error: `씬 ${scene.id} 에 next 도 choices 도 ending 도 없다` };
}

export function reduce(script: VnScript, state: VnState, action: VnAction): VnState {
  switch (action.type) {
    case "start":
      return enterScene(script, { ...state, affection: 0, history: [], endingTitle: null }, script.start);

    case "restore":
      return {
        ...enterScene(script, { ...state, affection: action.affection, history: [], endingTitle: null }, action.sceneId),
        lineIndex: action.lineIndex,
      };

    case "backToTitle":
      return { ...state, phase: "title", endingTitle: null, error: null };

    case "advance": {
      if (state.phase !== "scene") return state;
      const scene = findScene(script, state.sceneId);
      if (!scene) return { ...state, error: `알 수 없는 씬 id: ${state.sceneId}` };
      const shown = lineOf(scene, state.lineIndex);
      const history = shown ? [...state.history, shown] : state.history;
      if (state.lineIndex + 1 < scene.lines.length) {
        return { ...state, lineIndex: state.lineIndex + 1, history };
      }
      return leaveScene(script, { ...state, history }, scene);
    }

    case "skipScene": {
      if (state.phase !== "scene") return state;
      const scene = findScene(script, state.sceneId);
      if (!scene) return { ...state, error: `알 수 없는 씬 id: ${state.sceneId}` };
      const rest: HistoryEntry[] = [];
      for (let i = state.lineIndex; i < scene.lines.length; i += 1) {
        const entry = lineOf(scene, i);
        if (entry) rest.push(entry);
      }
      return leaveScene(script, { ...state, history: [...state.history, ...rest] }, scene);
    }

    case "choose": {
      if (state.phase !== "choice") return state;
      const scene = findScene(script, state.sceneId);
      const choice = scene?.choices?.[action.index];
      if (!choice) return { ...state, error: `선택지 ${action.index} 가 없다` };
      const picked: HistoryEntry = { speaker: null, text: `▷ ${choice.text}` };
      return enterScene(
        script,
        { ...state, affection: state.affection + (choice.affection ?? 0), history: [...state.history, picked] },
        choice.next,
      );
    }

    default:
      return state;
  }
}
