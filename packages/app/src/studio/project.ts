import { auditScript, script, parseLines, parseScene, parseScript, BACKGROUNDS, BGM } from "@vnmaker/content";
import type { Scene, VnScript } from "@vnmaker/content";

export const PROJECT_KEY = "vnmaker.studio.project.v1";
export const POSITION_KEY = "vnmaker.studio.position.v1";
export const sceneTitle = (scene: Scene) => scene.chapter || scene.id;
export const backgroundSrc = (scene: Scene) => scene.cgUrl ?? scene.lines.find(line=>line.cgUrl)?.cgUrl ?? scene.backgroundUrl ?? `/assets/bg/${scene.background}.png`;
export const newSceneId = () => `scene-${crypto.randomUUID().slice(0, 8)}`;

export const PROJECT_META_KEY = "vnmaker.studio.project.meta.v1";
export interface QuickRecoveryMeta { readonly updatedAt: number; readonly hash: string }
/** FNV-1a 32 + 길이. 메타 기록이 PROJECT_KEY 아래의 바로 그 텍스트와 짝인지 확인하는 용도다. */
export function quickRecoveryHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}
/**
 * 빠른 복구 사본을 쓴다. 원고 쓰기 실패는 호출자가 결정하도록 그대로 던진다.
 * 메타 쓰기만 실패하면 메타를 지운다 — 나이를 모르는 사본이 나이를 잘못 아는 사본보다 안전하다.
 */
export function writeQuickRecovery(script: VnScript, storage: Storage = localStorage, now = Date.now()): string {
  const json = JSON.stringify(script);
  storage.setItem(PROJECT_KEY, json);
  const hash = quickRecoveryHash(json);
  try { storage.setItem(PROJECT_META_KEY, JSON.stringify({ updatedAt: now, hash })); }
  catch { try { storage.removeItem(PROJECT_META_KEY); } catch { /* 저장 공간이 완전히 막힌 상태 — 원고 사본이 남아 있다. */ } }
  return hash;
}
/** 지금 저장된 사본이 이 세션이 마지막으로 쓴 것인지. 다른 곳(다른 도구·복구 절차)이 바꾼 사본을 pagehide 가 덮어쓰면 안 된다. */
export function ownsQuickRecovery(lastWritten: string | null, storage: Storage = localStorage): boolean {
  if (lastWritten === null) return false;
  try { const current = storage.getItem(PROJECT_KEY); return current !== null && quickRecoveryHash(current) === lastWritten; } catch { return false; }
}
/** 보관함이 더 새로울 때 오래된 사본을 남기면 다음 실행이 그 사본으로 보관함을 덮어쓴다. removeItem 은 용량 초과로 실패하지 않는다. */
export function clearQuickRecovery(storage: Storage = localStorage): void {
  storage.removeItem(PROJECT_KEY);
  storage.removeItem(PROJECT_META_KEY);
}
/** 저장된 텍스트와 짝이 맞는 메타만 돌려준다. 레거시(메타 없음)나 어긋난 메타는 null — 나이를 모른다는 뜻. */
export function readQuickRecoveryMeta(raw: string, storage: Storage = localStorage): QuickRecoveryMeta | null {
  try {
    const meta = JSON.parse(storage.getItem(PROJECT_META_KEY) ?? "null") as Partial<QuickRecoveryMeta> | null;
    if (!meta || typeof meta !== "object" || typeof meta.updatedAt !== "number" || !Number.isFinite(meta.updatedAt) || typeof meta.hash !== "string") return null;
    return meta.hash === quickRecoveryHash(raw) ? { updatedAt: meta.updatedAt, hash: meta.hash } : null;
  } catch { return null; }
}

export function loadProject(storage: Storage = localStorage): { script: VnScript; error: string | null } {
  let saved: string | null = null;
  try { saved = storage.getItem(PROJECT_KEY); } catch { /* 저장소 접근 불가 — 아래에서 샘플과 안내를 돌려준다. */ }
  if (saved === null) return { script: structuredClone(script), error: null };
  try {
    return { script: parseScript(JSON.parse(saved)), error: null };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { script: structuredClone(script), error: `저장한 작품을 읽지 못했습니다 (${reason}). 원본 저장 데이터는 유지했습니다. 아래에서 보관함 원고로 복구하거나, 제한을 넘은 부분을 잘라 복구하거나, JSON 백업을 가져오세요.` };
  }
}

const LIMITS = { text: 20_000, lines: 2_000, scenes: 300, choices: 8, characters: 200, assets: 2_000, audio: 5_000 } as const;
const clipText = (value: unknown, max: number) => typeof value === "string" && value.length > max ? value.slice(0, max) : value;
/**
 * 검증 상한(대사 20,000자·씬당 2,000줄·300씬 등)을 넘어 읽을 수 없게 된 원고를 상한에 맞춰 잘라 되살린다.
 * 잘린 내용은 changes 에 남긴다. 상한 초과 이외의 손상(구조 파손 등)은 되살리지 못하고 null 을 돌려준다.
 */
export function salvageScript(raw: unknown): { script: VnScript; changes: string[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const changes: string[] = [];
  const source = structuredClone(raw) as Record<string, unknown>;
  const clip = (owner: Record<string, unknown>, key: string, label: string) => {
    const before = owner[key];
    const after = clipText(before, LIMITS.text);
    if (after !== before) { owner[key] = after; changes.push(`${label}을(를) ${LIMITS.text.toLocaleString()}자로 잘랐습니다.`); }
  };
  const truncate = (rows: unknown, max: number, label: string): unknown => {
    if (!Array.isArray(rows) || rows.length <= max) return rows;
    changes.push(`${label} ${rows.length.toLocaleString()}개 중 처음 ${max.toLocaleString()}개만 남겼습니다.`);
    return rows.slice(0, max);
  };
  clip(source, "title", "작품 제목"); clip(source, "subtitle", "작품 설명"); clip(source, "artDirection", "아트 디렉션");
  source["characters"] = truncate(source["characters"], LIMITS.characters, "등장인물");
  source["assets"] = truncate(source["assets"], LIMITS.assets, "아트 에셋");
  source["audioAssets"] = truncate(source["audioAssets"], LIMITS.audio, "음원");
  source["scenes"] = truncate(source["scenes"], LIMITS.scenes, "씬");
  if (Array.isArray(source["scenes"])) for (const [sceneIndex, item] of source["scenes"].entries()) {
    if (!item || typeof item !== "object") continue;
    const scene = item as Record<string, unknown>;
    const name = typeof scene["chapter"] === "string" && scene["chapter"] ? scene["chapter"].slice(0, 40) : typeof scene["id"] === "string" ? scene["id"].slice(0, 40) : `씬 ${sceneIndex + 1}`;
    clip(scene, "id", `${name}의 씬 ID`); clip(scene, "chapter", `${name}의 장 제목`); clip(scene, "ending", `${name}의 엔딩 제목`); clip(scene, "artBrief", `${name}의 아트 브리프`);
    scene["lines"] = truncate(scene["lines"], LIMITS.lines, `${name}의 대사`);
    if (Array.isArray(scene["lines"])) for (const [lineIndex, line] of scene["lines"].entries()) if (line && typeof line === "object") clip(line as Record<string, unknown>, "text", `${name} ${lineIndex + 1}번째 대사`);
    scene["choices"] = truncate(scene["choices"], LIMITS.choices, `${name}의 선택지`);
    if (Array.isArray(scene["choices"])) for (const choice of scene["choices"]) if (choice && typeof choice === "object") { clip(choice as Record<string, unknown>, "text", `${name}의 선택지 문구`); clip(choice as Record<string, unknown>, "next", `${name}의 선택지 연결`); }
  }
  for (const key of ["characters", "assets", "audioAssets"] as const) if (source[key] === undefined) delete source[key];
  try { return changes.length ? { script: parseScript(source), changes } : null; } catch { return null; }
}

export interface HistoryState {
  readonly past: readonly VnScript[];
  readonly present: VnScript;
  readonly future: readonly VnScript[];
  readonly group?: string | undefined;
  readonly at?: number;
}
export type HistoryAction = { type: "edit"; script: VnScript; group?: string; at: number } | { type: "undo" | "redo" } | {type:"reset";script:VnScript};
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if(action.type==="reset")return {past:[],present:action.script,future:[]};
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
  const cast = [...new Set(["me", ...script.characters.map(character => character.id)])];
  const schema = `Line={speaker:null|${cast.map(id => JSON.stringify(id)).join("|")},text:string,expression?:"neutral"|"smile"|"sad"|"surprised"}. Scene={id:string,chapter:string,background:string,bgm?:string,sprites?:[{slot:"left"|"center"|"right",character:${cast.map(id => JSON.stringify(id)).join("|")},expression:"neutral"}],lines:Line[],next?:string,choices?:[{text:string,next:string}],ending?:string}. 엔딩은 ending, 일반 씬은 next, 분기는 choices 중 하나만 사용. 배경: ${JSON.stringify(BACKGROUNDS)}. 음악: ${JSON.stringify(BGM)}. 인물: ${JSON.stringify(script.characters)}.\n`;
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
