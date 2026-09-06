import { applyChoiceFlags, choiceAllowed, lineAllowed, type Scene, type StoryFlags, type VnScript } from "@vnmaker/content";
import { findScene, type HistoryEntry, type VnAction, type VnState } from "./types.js";

function lineOf(scene: Scene, index: number): HistoryEntry | null {
  const line = scene.lines[index];
  if (!line) return null;
  return { speaker: line.speaker ?? null, text: line.text, sceneId: scene.id, chapter: scene.chapter || scene.id };
}

function nextVisible(scene: Scene, start: number, flags: StoryFlags) {
  for (let index = start; index < scene.lines.length; index++) if (lineAllowed(scene.lines[index]!, flags)) return index;
  return -1;
}

function enterScene(script: VnScript, state: VnState, id: string, visited: string[] = []): VnState {
  const scene = findScene(script, id);
  if (!scene) {
    return { ...state, error: `알 수 없는 씬 id: ${id}` };
  }
  if (visited.includes(id)) return { ...state, error: "표시할 대사가 없는 장면이 순환합니다." };
  const lineIndex = nextVisible(scene, 0, state.flags);
  const entered: VnState = {
    ...state,
    phase: "scene",
    sceneId: id,
    lineIndex: Math.max(0, lineIndex),
    error: null,
    sceneEpoch: state.sceneEpoch + 1,
  };
  return lineIndex < 0 ? leaveScene(script, entered, scene, [...visited, id]) : entered;
}

/** 씬의 마지막 줄을 지난 뒤 어디로 갈지 결정한다. */
function leaveScene(script: VnScript, state: VnState, scene: Scene, visited: string[] = []): VnState {
  if (scene.choices && scene.choices.length > 0) {
    if(!scene.choices.some(choice=>choiceAllowed(choice,state.flags)))return {...state,error:`씬 ${scene.id}: 현재 상태에서 선택할 수 있는 선택지가 없습니다.`};
    return { ...state, phase: "choice" };
  }
  if (scene.ending) {
    return { ...state, phase: "ending", endingTitle: scene.ending };
  }
  if (scene.next) {
    return enterScene(script, state, scene.next, visited);
  }
  return { ...state, error: `씬 ${scene.id} 에 next 도 choices 도 ending 도 없다` };
}

export function reduce(script: VnScript, state: VnState, action: VnAction): VnState {
  switch (action.type) {
    case "start":
      return enterScene(script, { ...state, flags: { ...script.flags }, affection: 0, history: [], endingTitle: null }, script.start);

    case "restore": {
      const scene = findScene(script, action.sceneId);
      if (!scene) return { ...state, error: `알 수 없는 씬 id: ${action.sceneId}` };
      const flags = { ...script.flags, ...action.flags };
      const restored = enterScene(script, { ...state, flags, affection: action.affection, history: action.history ?? [], endingTitle: null }, action.sceneId);
      const requested = Math.min(scene.lines.length - 1, Math.max(0, Math.floor(action.lineIndex)));
      const lineIndex = nextVisible(scene, requested, flags);
      if (action.phase === "choice" && scene.choices?.length) return { ...restored, phase: "choice", lineIndex: Math.max(0, requested) };
      if (action.phase === "ending" && scene.ending) return { ...restored, phase: "ending", endingTitle: scene.ending, lineIndex: Math.max(0, requested) };
      return lineIndex < 0 ? leaveScene(script, restored, scene) : { ...restored, lineIndex };
    }

    case "backToTitle":
      return { ...state, phase: "title", endingTitle: null, error: null };

    case "advance": {
      if (state.phase !== "scene") return state;
      const scene = findScene(script, state.sceneId);
      if (!scene) return { ...state, error: `알 수 없는 씬 id: ${state.sceneId}` };
      const shown = lineOf(scene, state.lineIndex);
      const history = shown ? [...state.history, shown] : state.history;
      const lineIndex = nextVisible(scene, state.lineIndex + 1, state.flags);
      if (lineIndex >= 0) {
        return { ...state, lineIndex, history };
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
        if (entry && lineAllowed(scene.lines[i]!, state.flags)) rest.push(entry);
      }
      return leaveScene(script, { ...state, lineIndex: scene.lines.length - 1, history: [...state.history, ...rest] }, scene);
    }

    case "choose": {
      if (state.phase !== "choice") return state;
      const scene = findScene(script, state.sceneId);
      const choice = scene?.choices?.[action.index];
      if (!choice) return { ...state, error: `선택지 ${action.index} 가 없다` };
      if (!choiceAllowed(choice,state.flags)) return state;
      const picked: HistoryEntry = { speaker: null, text: `▷ ${choice.text}`, sceneId: scene!.id, chapter: scene!.chapter || scene!.id };
      return enterScene(
        script,
        { ...state, flags: applyChoiceFlags(state.flags,choice), affection: state.affection + (choice.affection ?? 0), history: [...state.history, picked] },
        choice.next,
      );
    }

    default:
      return state;
  }
}
