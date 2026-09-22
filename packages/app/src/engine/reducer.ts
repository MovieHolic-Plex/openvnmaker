import { applyChoiceFlags, choiceAllowed, lineAllowed, type Scene, type StoryFlags, type VnScript } from "@vnmaker/content";
import { findScene, hasReadKey, type HistoryEntry, type PastSnapshot, type RollbackEntry, type VnAction, type VnState } from "./types.js";

const PAST_LIMIT = 300;
/** 대사 기록(백로그·세이브) 상한 — 긴 세션에서도 자동 저장이 선형 비용을 유지하게 한다. */
const HISTORY_LIMIT = 2000;

function snapshotOf(state: VnState): PastSnapshot {
  return { sceneId: state.sceneId, lineIndex: state.lineIndex, affection: state.affection, flags: state.flags, phase: state.phase, endingTitle: state.endingTitle, history: state.history, inputFlags: state.inputFlags };
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

/** 가려진 씬 체인의 순환 감지용 — 같은 씬을 같은 플래그로 다시 들르면 결과도 같으므로 순환 확정. */
interface Hop { readonly id: string; readonly sig: string }
function flagSig(flags: StoryFlags): string {
  return JSON.stringify(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)));
}

function enterScene(script: VnScript, state: VnState, id: string, visited: Hop[] = [], applySet = true): VnState {
  const scene = findScene(script, id);
  if (!scene) {
    return { ...state, error: `알 수 없는 씬 id: ${id}` };
  }
  // 진입 시점 set — 첫 대사의 when 과 조건 경로가 이 플래그를 본다.
  // 독자가 input 줄로 넣은 플래그는 set 이 덮어쓰지 않는다 — 입력값은 작성자 기본값보다 우선한다(세이브 복원과 같은 규칙).
  const set = applySet && scene.set ? Object.fromEntries(Object.entries(scene.set).filter(([key]) => !state.inputFlags.includes(key))) : null;
  const flags = set ? { ...state.flags, ...set } : state.flags;
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
  if (lineIndex >= 0) return entered;
  // 모든 줄이 가려진 씬만 순환 검사한다 — 거쳐간 씬의 set 이 이 씬의 줄이나 경로를
  // 새로 열었으면 재진입은 순환이 아니라 정상 진행이다. 같은 씬+같은 플래그의 재방문만 막는다.
  const sig = flagSig(flags);
  if (visited.some(hop => hop.id === id && hop.sig === sig)) return { ...state, error: "표시할 대사가 없는 장면이 순환합니다." };
  // 플래그가 매번 바뀌는 비정상 원고의 무한 체인도 멈춘다.
  if (visited.length >= 512) return { ...state, error: "장면 전환이 너무 많습니다 — 조건 경로의 순환을 확인하세요." };
  return leaveScene(script, entered, scene, [...visited, { id, sig }]);
}

/** 씬의 마지막 줄을 지난 뒤 어디로 갈지 결정한다. 조건 경로가 씬 자체 출구(엔딩·다음)보다 먼저 평가된다. */
function leaveScene(script: VnScript, state: VnState, scene: Scene, visited: Hop[] = []): VnState {
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
  const history = shown ? [...state.history.slice(-(HISTORY_LIMIT - 1)), shown] : state.history;
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
    const clamped = Math.min(scene.lines.length - 1, Math.max(0, Math.floor(entry.lineIndex)));
    const flags = { ...script.flags, ...entry.flags };
    // 저장 이후 원고가 바뀌어 그 위치의 줄이 when 에 가려졌으면 다음 보이는 줄로 보정한다 —
    // 되돌리기가 보이지 않아야 할 줄을 다시 렌더하면 안 된다.
    const visible = nextVisible(scene, clamped, flags);
    // 씬 전체가 가려졌으면 되돌릴 수 있는 위치가 아니다 — 건너뛴다.
    if (visible < 0) continue;
    // 선택지 단계로 저장됐어도 지금 고를 수 있는 선택지가 없으면 scene 으로 낮춘다 —
    // 버튼 없는 선택 화면에 되돌아가면 빠져나올 수 없다.
    const phase = entry.phase === "choice" && scene.choices?.length && scene.choices.some(choice => choiceAllowed(choice, flags)) ? "choice" : "scene";
    past.push({ sceneId: entry.sceneId, lineIndex: visible, affection: entry.affection, flags, phase, endingTitle: null, history: history.slice(0, Math.max(0, Math.min(history.length, entry.historyLength))), inputFlags: entry.inputFlags ?? [] });
  }
  return past;
}

/** 세이브에 담을 압축 롤백 기록. 최근 항목만 남긴다. */
export function rollbackLog(state: VnState, limit: number): RollbackEntry[] {
  return state.past.slice(-limit).map(entry => ({ sceneId: entry.sceneId, lineIndex: entry.lineIndex, affection: entry.affection, flags: entry.flags, phase: entry.phase, historyLength: entry.history.length, inputFlags: entry.inputFlags }));
}

export function reduce(script: VnScript, state: VnState, action: VnAction): VnState {
  switch (action.type) {
    case "start":
      return enterScene(script, { ...state, flags: { ...script.flags }, affection: 0, history: [], past: [], endingTitle: null, inputFlags: [] }, script.start);

    case "restore": {
      const scene = findScene(script, action.sceneId);
      if (!scene) return { ...state, error: `알 수 없는 씬 id: ${action.sceneId}` };
      // 저장된 플래그가 진입 시점 set 을 이긴다 — 입력 줄이 수집한 값을 복원이 덮어쓰지 않게.
      // 저장에 없는 키(원고가 나중에 추가한 set)는 set 값으로 채운다.
      const flags = { ...script.flags, ...(scene.set ?? {}), ...action.flags };
      const history = action.history ?? [];
      const restored = enterScene(script, { ...state, flags, affection: action.affection, history, past: rebuildPast(script, action.rollback, history), endingTitle: null, inputFlags: action.inputFlags ?? [] }, action.sceneId, [], false);
      // enterScene 이 체인해서 다른 씬·단계에 도착했으면(모든 줄이 when 에 가려진 경우 등)
      // 저장 위치는 재현 불가 — 요청한 씬의 phase/exits/엔딩을 도착 상태에 억지로 입히지 않는다.
      if (restored.error !== null || restored.sceneId !== action.sceneId || restored.phase !== "scene") return restored;
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
      // 치명 오류 위에서는 진행 액션이 past/history 를 오염시키지 않게 한다 — 되돌리기로만 복구한다.
      if (state.phase !== "scene" || state.error !== null) return state;
      // 입력을 받는 줄은 넘기기 전에 값이 와야 한다 — 그냥 넘어가면 {flag:…} 가 빈 채로 풀린다.
      const scene = findScene(script, state.sceneId);
      if (scene?.lines[state.lineIndex]?.input) return state;
      return advanceOnce(script, pushPast(state));
    }

    case "input": {
      if (state.phase !== "scene" || state.error !== null) return state;
      const scene = findScene(script, state.sceneId);
      const line = scene?.lines[state.lineIndex];
      // 현재 줄이 이 플래그를 묻는 input 줄일 때만 값을 받는다 — 다른 줄에서 온 입력은 무시한다.
      if (!scene || line?.input?.flag !== action.flag) return state;
      // trim 후 코드포인트 기준으로 자른다 — 앞자르기는 "  ab"를 "a"로 만들고
      // 서로게이트 쌍을 반으로 쪼갤 수 있다.
      const value = [...action.value.trim()].slice(0, line.input.max ?? 16).join("");
      if (!value) return state;
      // 정규 숫자 문자열은 숫자 플래그로 저장한다 — compare/add 가 숫자를 요구하므로.
      // "007"·"3.50" 같은 비정규 표기는 문자열을 유지한다(이름 플래그 오염 방지).
      const num = Number(value);
      const stored = Number.isFinite(num) && String(num) === value ? num : value;
      const inputFlags = state.inputFlags.includes(action.flag) ? state.inputFlags : [...state.inputFlags, action.flag];
      return advanceOnce(script, { ...pushPast(state), flags: { ...state.flags, [action.flag]: stored }, inputFlags });
    }

    case "skipToChoice": {
      // 현재 씬 안에서만 건너뛴다. 씬이 끝나면 선택지·다음 씬 첫 줄에서 멈추고, 엔딩은 마지막 줄에서 멈춰 독자가 직접 넘기게 한다.
      // 순환하는 next 도 한 씬만 이동하므로 기록이 폭주하지 않는다.
      if (state.phase !== "scene" || state.error !== null) return state;
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
          if (action.readKeys && !hasReadKey(action.readKeys, scene.id, upcoming, scene.lines[upcoming])) break;
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
      if (state.phase !== "choice" || state.error !== null) return state;
      const scene = findScene(script, state.sceneId);
      const choice = scene?.choices?.[action.index];
      if (!choice) return { ...state, error: `선택지 ${action.index} 가 없다` };
      if (!choiceAllowed(choice,state.flags)) return state;
      const picked: HistoryEntry = { speaker: null, text: `▷ ${choice.text}`, sceneId: scene!.id, chapter: scene!.chapter || scene!.id };
      const affection = state.affection + (choice.affection ?? 0);
      return enterScene(
        script,
        { ...pushPast(state), flags: applyChoiceFlags(state.flags,choice), affection: Number.isFinite(affection) ? affection : state.affection, history: [...state.history.slice(-(HISTORY_LIMIT - 1)), picked] },
        choice.next,
      );
    }

    default:
      return state;
  }
}
