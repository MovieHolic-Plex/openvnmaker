import { auditScript, script, parseLines, parseScene, parseScript, BACKGROUNDS, BGM } from "@vnmaker/content";
import type { Scene, VnScript } from "@vnmaker/content";

export const PROJECT_KEY = "vnmaker.studio.project.v1";
export const POSITION_KEY = "vnmaker.studio.position.v1";
export const sceneTitle = (scene: Scene) => scene.chapter || scene.id;
export const backgroundSrc = (scene: Scene) => scene.cgUrl ?? scene.lines.find(line=>line.cgUrl)?.cgUrl ?? scene.backgroundUrl ?? `/assets/bg/${scene.background}.png`;
export const newSceneId = () => `scene-${crypto.randomUUID().slice(0, 8)}`;

export function loadProject(): { script: VnScript; error: string | null } {
  try {
    const saved = localStorage.getItem(PROJECT_KEY);
    return { script: saved ? parseScript(JSON.parse(saved)) : structuredClone(script), error: null };
  } catch {
    return { script: structuredClone(script), error: "저장한 작품을 읽지 못했습니다. 원본 저장 데이터는 유지했습니다. JSON 백업을 가져와 복구하거나, 현재 샘플을 저장하세요." };
  }
}

export interface HistoryState {
  readonly past: readonly VnScript[];
  readonly present: VnScript;
  readonly future: readonly VnScript[];
  readonly group?: string | undefined;
  readonly at?: number;
}
export type HistoryAction = { type: "edit"; script: VnScript; group?: string; at: number } | { type: "undo" | "redo" } | {type:"reset";script:VnScript} | { type: "apply"; script: VnScript; receiptId: string };
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if(action.type==="reset")return {past:[],present:action.script,future:[]};
  if(action.type==="apply")return {past:[...state.past.slice(-59),state.present],present:action.script,future:[],group:`apply:${action.receiptId}`,at:0};
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
  }
  if (action.type !== "edit" || action.script === state.present) return state;
  const grouped = action.group && action.group === state.group && action.at - (state.at ?? 0) < 1200;
  return { past: grouped ? state.past : [...state.past.slice(-59), state.present], present: action.script, future: [], group: action.group, at: action.at };
}

export type AiMode = "rewrite" | "continue" | "branch" | "project" | "image";
export const AI_MODES: { id: AiMode; label: string; hint: string }[] = [
  { id: "rewrite", label: "대사 다듬기", hint: "선택한 대사의 감정과 말투를 바꿉니다." },
  { id: "continue", label: "이어서 쓰기", hint: "현재 씬의 맥락을 읽고 대사를 이어 씁니다." },
  { id: "branch", label: "선택지와 분기", hint: "두 선택지와 이어지는 씬을 함께 만듭니다." },
  { id: "project", label: "작품 초안", hint: "시작부터 분기와 엔딩까지 새 작품을 제안합니다." },
  { id: "image", label: "배경 그리기", hint: "생성한 배경을 검토하고 현재 씬에 적용합니다." },
];

export interface Proposal {
  readonly title: string;
  readonly detail: string;
  readonly base: VnScript;
  readonly next: VnScript;
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly model: string;
  readonly imageUrl?: string;
}

export function makePrompt(mode: Exclude<AiMode, "image">, instruction: string, script: VnScript, scene: Scene, lineIndex: number): string {
  const common = `당신은 한국어 비주얼 노벨 공동 작가다. 설명이나 마크다운 없이 유효한 JSON만 출력한다. 대사는 구체적이고 자연스럽게 쓴다. 사용자 지시: ${instruction}\n`;
  const schema = `Line={speaker:null|"me"|"seorin"|"dohyun"|"mirae",text:string,expression?:"neutral"|"smile"|"sad"|"surprised"}. Scene={id:string,chapter:string,background:string,bgm?:string,sprites?:[{slot:"left"|"center"|"right",character:"seorin"|"dohyun"|"mirae",expression:"neutral"}],lines:Line[],next?:string,choices?:[{text:string,next:string}],ending?:string}. 엔딩은 ending, 일반 씬은 next, 분기는 choices 중 하나만 사용. 배경: ${JSON.stringify(BACKGROUNDS)}. 음악: ${JSON.stringify(BGM)}. 인물: ${JSON.stringify(script.characters)}.\n`;
  if (mode === "project") return common + schema + `새 완결 작품 JSON {title,subtitle,start,characters,scenes}을 작성한다. 기존 인물 ID와 이름을 유지하되 새 줄거리를 만든다. 4~6개의 씬, 씬마다 4~8줄, 두 개 이상의 선택지와 서로 다른 엔딩. 모든 next와 choices.next는 실제 씬 ID를 참조한다. 모든 씬이 start에서 도달 가능해야 한다. 새로운 이미지 경로나 backgroundUrl은 만들지 않는다.`;
  const context = `작품: ${script.title}. 전체 구성: ${JSON.stringify(script.scenes.map(row => ({ id: row.id, chapter: row.chapter, next: row.next, choices: row.choices, ending: row.ending })))}. 현재 씬: ${JSON.stringify({ ...scene, lines: scene.lines.slice(-35) })}. 선택한 대사: ${JSON.stringify(scene.lines[lineIndex])}.\n`;
  const task = mode === "rewrite"
    ? '출력 {"lines":[Line]}: 선택한 대사만 정확히 한 줄 수정한다. 화자와 사건의 사실 관계를 유지한다.'
    : mode === "continue"
      ? '출력 {"lines":[Line,...]}: 현재 씬 끝에 이어질 새로운 대사 4~8줄을 쓴다. 기존 대사를 반복하지 않는다.'
      : '출력 {"branches":[{"text":"선택지 문구","scene":Scene},{"text":"다른 선택지 문구","scene":Scene}]}: 다른 결과를 만드는 분기 두 개. 각 씬은 3~6줄. id는 임시 문자열, next/choices/ending은 생략한다. 후속 연결은 에디터가 관리한다.';
  const prompt = common + schema + context + task;
  if (prompt.length > 16000) throw new Error("현재 씬의 맥락이 너무 깁니다. 씬을 나눈 뒤 다시 요청하세요.");
  return prompt;
}

export function parseProposal(text: string, mode: Exclude<AiMode, "image">, base: VnScript, scene: Scene, lineIndex: number, model: string): Proposal {
  let raw: unknown;
  try { raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("AI 응답이 올바른 JSON이 아닙니다. 작품은 변경되지 않았습니다. 다시 생성해 주세요."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI가 작품 형식에 맞는 응답을 보내지 않았습니다.");
  const data = raw as Record<string, unknown>;
  let next: VnScript;
  let title: string;
  let detail: string;
  let selectId = scene.id;
  let before: string[];
  let after: string[];
  if (mode === "project") {
    next = parseScript(raw);
    const issues = auditScript(next);
    if (issues.length) throw new Error(`AI 작품 검증 실패: ${issues[0]!.message} 다시 생성해 주세요.`);
    title = "새 작품 초안";
    detail = `${next.title} · ${next.scenes.length}개 씬 · 적용하면 현재 작품을 교체합니다. 실행 취소로 복원할 수 있습니다.`;
    selectId = next.start;
    before = [base.title, `${base.scenes.length}개의 씬`];
    after = next.scenes.map(row => `${sceneTitle(row)} · ${row.lines.length}줄${row.ending ? " · 엔딩" : ""}`);
  } else if (mode === "branch") {
    if (!Array.isArray(data["branches"]) || data["branches"].length !== 2) throw new Error("AI 분기에는 두 개의 선택지가 필요합니다.");
    const branches = data["branches"].map((item: unknown) => {
      if (!item || typeof item !== "object") throw new Error("AI 분기 형식이 올바르지 않습니다.");
      const branch = item as Record<string, unknown>;
      if (typeof branch["text"] !== "string" || !branch["text"].trim()) throw new Error("선택지 문구가 비어 있습니다.");
      const parsed = parseScene(branch["scene"]);
      const { next: _next, choices: _choices, ending: _ending, backgroundUrl: _url, ...rest } = parsed;
      const newScene: Scene = { ...rest, id: newSceneId(), ...(scene.next ? { next: scene.next } : { ending: parsed.chapter || branch["text"] }) };
      return { text: branch["text"], scene: newScene };
    });
    const { next: _next, ending: _ending, ...rest } = scene;
    const updated = { ...rest, choices: branches.map(branch => ({ text: branch.text, next: branch.scene.id })) };
    next = { ...base, scenes: [...base.scenes.map(row => row.id === scene.id ? updated : row), ...branches.map(branch => branch.scene)] };
    title = "두 갈래의 새로운 이야기";
    detail = "선택지 2개와 연결된 씬 2개를 추가합니다. 이 씬의 기존 출구를 교체합니다.";
    before = scene.choices?.map(choice => choice.text) ?? [scene.next ? "다음 씬으로 이동" : "엔딩"];
    after = branches.flatMap(branch => [branch.text, ...branch.scene.lines.map(line => line.text)]);
  } else {
    const lines = parseLines(data["lines"]);
    if (lines.some(line => !line.text.trim()) || lines.length > 80 || (mode === "rewrite" && lines.length !== 1)) throw new Error("AI가 요청한 대사 수나 형식을 지키지 않았습니다.");
    const nextLines = mode === "rewrite" ? scene.lines.map((line, index) => index === lineIndex ? { ...line, ...lines[0]! } : line) : [...scene.lines, ...lines];
    next = { ...base, scenes: base.scenes.map(row => row.id === scene.id ? { ...row, lines: nextLines } : row) };
    title = mode === "rewrite" ? "대사 수정 제안" : "이어서 쓴 대사";
    detail = `${sceneTitle(scene)} · ${lines.length}줄 ${mode === "rewrite" ? "수정" : "추가"}`;
    before = mode === "rewrite" ? [scene.lines[lineIndex]!.text] : [];
    after = lines.map(line => line.text);
  }
  parseScript(next);
  if (after.some(text => !text.trim())) throw new Error("AI가 빈 내용을 반환했습니다.");
  return { title, detail, base, next, sceneId: selectId, lineIndex: mode === "project" ? 0 : mode === "continue" ? scene.lines.length : lineIndex, before, after, model };
}
