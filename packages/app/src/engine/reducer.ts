import { applyChoiceFlags, choiceAllowed, lineAllowed, type Scene, type StoryFlags, type VnScript } from "@vnmaker/content";
import { findScene, readKey, type HistoryEntry, type PastSnapshot, type RollbackEntry, type VnAction, type VnState } from "./types.js";

const PAST_LIMIT = 300;

function snapshotOf(state: VnState): PastSnapshot {
  return { sceneId: state.sceneId, lineIndex: state.lineIndex, affection: state.affection, flags: state.flags, phase: state.phase, endingTitle: state.endingTitle, history: state.history };
}

function pushPast(state: VnState): VnState {
  return { ...state, past: [...state.past.slice(-(PAST_LIMIT - 1)), snapshotOf(state)] };
}

function lineOf(scene: Scene, index: number): HistoryEntry | null {
  const line = scene.lines[index];
  if (!line) return null;
  return { speaker: line.speaker ?? null, text: line.text, sceneId: scene.id, chapter: scene.chapter || scene.id };
}

function nextVisible(scene: Scene, start: number, flags: StoryFlags) {
  for (let index = start; index < scene.lines.length; index++) if (lineAllowed(scene.lines[index]!, flags)) return index;
  return -1;
}

function enterScene(script: VnScript, state: VnState, id: string, visited: string[] = [], applySet = true): VnState {
  const scene = findScene(script, id);
  if (!scene) {
    return { ...state, error: `알 수 없는 씬 id: ${id}` };
  }
  if (visited.includes(id)) return { ...state, error: "표시할 대사가 없는 장면이 순환합니다." };
  // 진입 시점 set — 첫 대사의 when 과 조건 경로가 이 플래그를 본다.
  const flags = applySet && scene.set ? { ...state.flags, ...scene.set } : state.flags;
  const lineIndex = nextVisible(scene, 0, flags);
  const entered: VnState = {
    ...state,
    flags,
    phase: "scene",
    sceneId: id,
    lineIndex: Math.max(0, lineIndex),
    error: null,
    sceneEpoch: state.sceneEpoch + 1,
  };
  return lineIndex < 0 ? leaveScene(script, entered, scene, [...visited, id]) : entered;
}

/** 씬의 마지막 줄을 지난 뒤 어디로 갈지 결정한다. 조건 경로가 씬 자체 출구(엔딩·다음)보다 먼저 평가된다. */
function leaveScene(script: VnScript, state: VnState, scene: Scene, visited: string[] = []): VnState {
  if (scene.choices && scene.choices.length > 0) {
    if(!scene.choices.some(choice=>choiceAllowed(choice,state.flags)))return {...state,error:`씬 ${scene.id}: 현재 상태에서 선택할 수 있는 선택지가 없습니다.`};
    return { ...state, phase: "choice" };
  }
  for (const route of scene.routes ?? []) {
    if (lineAllowed(route, state.flags)) return enterScene(script, state, route.next, visited);
  }
  if (scene.ending) {
    return { ...state, phase: "ending", endingTitle: scene.ending };
  }
  if (scene.next) {
    return enterScene(script, state, scene.next, visited);
  }
  return { ...state, error: `씬 ${scene.id} 에 next 도 choices 도 ending 도 없다` };
}

/** 한 줄 진행 — past 를 쌓지 않는 내부 단계. skipToChoice 의 루프에서도 쓴다. */
function advanceOnce(script: VnScript, state: VnState): VnState {
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

/** 세이브의 압축 롤백 기록을 past 스택으로 되살린다. 없는 씬이나 범위 밖 인덱스는 버린다. */
function rebuildPast(script: VnScript, entries: readonly RollbackEntry[] | undefined, history: readonly HistoryEntry[]): PastSnapshot[] {
  const past: PastSnapshot[] = [];
  for (const entry of entries ?? []) {
    const scene = findScene(script, entry.sceneId);
    if (!scene) continue;
    const lineIndex = Math.min(scene.lines.length - 1, Math.max(0, Math.floor(entry.lineIndex)));
    past.push({ sceneId: entry.sceneId, lineIndex, affection: entry.affection, flags: { ...script.flags, ...entry.flags }, phase: entry.phase === "choice" && scene.choices?.length ? "choice" : "scene", endingTitle: null, history: history.slice(0, Math.max(0, Math.min(history.length, entry.historyLength))) });
  }
  return past;
}

/** 세이브에 담을 압축 롤백 기록. 최근 항목만 남긴다. */
export function rollbackLog(state: VnState, limit: number): RollbackEntry[] {
  return state.past.slice(-limit).map(entry => ({ sceneId: entry.sceneId, lineIndex: entry.lineIndex, affection: entry.affection, flags: entry.flags, phase: entry.phase, historyLength: entry.history.length }));
}

export function reduce(script: VnScript, state: VnState, action: VnAction): VnState {
  switch (action.type) {
    case "start":
      return enterScene(script, { ...state, flags: { ...script.flags }, affection: 0, history: [], past: [], endingTitle: null }, script.start);

    case "restore": {
      const scene = findScene(script, action.sceneId);
      if (!scene) return { ...state, error: `알 수 없는 씬 id: ${action.sceneId}` };
      // 저장된 플래그가 진입 시점 set 을 이긴다 — 입력 줄이 수집한 값을 복원이 덮어쓰지 않게.
      // 저장에 없는 키(원고가 나중에 추가한 set)는 set 값으로 채운다.
      const flags = { ...script.flags, ...(scene.set ?? {}), ...action.flags };
      const history = action.history ?? [];
      const restored = enterScene(script, { ...state, flags, affection: action.affection, history, past: rebuildPast(script, action.rollback, history), endingTitle: null }, action.sceneId, [], false);
      const requested = Math.min(scene.lines.length - 1, Math.max(0, Math.floor(action.lineIndex)));
      const lineIndex = nextVisible(scene, requested, restored.flags);
      if (action.phase === "choice" && scene.choices?.length) {
        // 저장 뒤 원고나 조건이 바뀌어 고를 수 있는 선택지가 하나도 없으면 leaveScene 과 같은 복구 가능한 오류로 남긴다.
        // 조용히 선택 단계에 들어가면 버튼 없는 선택 화면에서 빠져나올 수 없다.
        if (!scene.choices.some(choice => choiceAllowed(choice, restored.flags))) return { ...restored, error: `씬 ${scene.id}: 저장된 위치에서 선택할 수 있는 선택지가 없습니다. 저장 당시와 원고나 선택 기억이 달라졌을 수 있습니다.` };
        return { ...restored, phase: "choice", lineIndex: Math.max(0, requested) };
      }
      if (action.phase === "ending" && scene.ending) return { ...restored, phase: "ending", endingTitle: scene.ending, lineIndex: Math.max(0, requested) };
      return lineIndex < 0 ? leaveScene(script, restored, scene) : { ...restored, lineIndex };
    }

    case "backToTitle":
      return { ...state, phase: "title", endingTitle: null, past: [], error: null };

    case "back": {
      const prev = state.past.at(-1);
      if (prev === undefined || state.phase === "title") return state;
      // 씬이 바뀌는 되돌리기면 전환 애니메이션을 다시 태운다.
      return { ...prev, past: state.past.slice(0, -1), sceneEpoch: prev.sceneId === state.sceneId ? state.sceneEpoch : state.sceneEpoch + 1, error: null };
    }

    case "advance": {
      if (state.phase !== "scene") return state;
      // 입력을 받는 줄은 넘기기 전에 값이 와야 한다 — 그냥 넘어가면 {flag:…} 가 빈 채로 풀린다.
      const scene = findScene(script, state.sceneId);
      if (scene?.lines[state.lineIndex]?.input) return state;
      return advanceOnce(script, pushPast(state));
    }

    case "input": {
      if (state.phase !== "scene") return state;
      const scene = findScene(script, state.sceneId);
      const line = scene?.lines[state.lineIndex];
      // 현재 줄이 이 플래그를 묻는 input 줄일 때만 값을 받는다 — 다른 줄에서 온 입력은 무시한다.
      if (!scene || line?.input?.flag !== action.flag) return state;
      const value = action.value.slice(0, line.input.max ?? 16).trim();
      if (!value) return state;
      // 정규 숫자 문자열은 숫자 플래그로 저장한다 — compare/add 가 숫자를 요구하므로.
      // "007"·"3.50" 같은 비정규 표기는 문자열을 유지한다(이름 플래그 오염 방지).
      const num = Number(value);
      const stored = Number.isFinite(num) && String(num) === value ? num : value;
      return advanceOnce(script, { ...pushPast(state), flags: { ...state.flags, [action.flag]: stored } });
    }

    case "skipToChoice": {
      // 현재 씬 안에서만 건너뛴다. 씬이 끝나면 선택지·다음 씬 첫 줄에서 멈추고, 엔딩은 마지막 줄에서 멈춰 독자가 직접 넘기게 한다.
      // 순환하는 next 도 한 씬만 이동하므로 기록이 폭주하지 않는다.
      if (state.phase !== "scene") return state;
      const scene = findScene(script, state.sceneId);
      if (!scene) return { ...state, error: `알 수 없는 씬 id: ${state.sceneId}` };
      // 입력 줄에 서 있는 동안은 스킵도 멈춘다 — 플래그 없이 지나치면 조건 선택지가 전부 닫혀 데드엔드가 된다.
      if (scene.lines[state.lineIndex]?.input) return state;
      let next = pushPast(state);
      let moved = false;
      for (let guard = 0; guard <= scene.lines.length; guard += 1) {
        const upcoming = nextVisible(scene, next.lineIndex + 1, next.flags);
        if (upcoming >= 0) {
          // 읽지 않은 대사 앞에서 멈춘다(「읽은 텍스트만 스킵」).
          if (action.readKeys && !action.readKeys.has(readKey(scene.id, upcoming, scene.lines[upcoming]))) break;
          next = advanceOnce(script, next); moved = true;
          // 입력 줄은 넘길 수 없다 — 스킵이 입력을 대신하지 못하게 그 줄에 도착하면 멈춘다.
          if (scene.lines[upcoming]!.input) break;
          continue;
        }
        if (scene.ending && !scene.choices?.length) break;
        next = advanceOnce(script, next); moved = true;
        break;
      }
      return moved ? next : state;
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
        { ...pushPast(state), flags: applyChoiceFlags(state.flags,choice), affection: state.affection + (choice.affection ?? 0), history: [...state.history, picked] },
        choice.next,
      );
    }

    default:
      return state;
  }
}
