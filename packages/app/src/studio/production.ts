import { applyChoiceFlags, auditScript, BACKGROUNDS, BGM, choiceAllowed, lineAllowed, parseLines, parseScene, parseScript } from "@vnmaker/content";
import type { Choice, Scene, StoryFlags, VnScript } from "@vnmaker/content";

export const PRODUCTION_KEY = "vnmaker.studio.production.v1";
export const PRODUCTION_BACKUP_KEY = "vnmaker.studio.production.previous.v1";
export const DEFAULT_READING_SPEED = 320;
export const countCharacters = (text: string) => Array.from(text.replace(/\s/gu, "")).length;
export const sceneCharacters = (scene: Pick<Scene, "lines">) => scene.lines.reduce((sum, line) => sum + countCharacters(line.text), 0);
export const scriptFingerprint = (script: VnScript) => {
  // 64비트 FNV-1a. 32비트는 자동 체크포인트 스킵 판정에 2^-32 거짓 음성이 있다.
  let hash = 0xcbf29ce484222325n;
  for (const char of JSON.stringify(script)) hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n);
  return hash.toString(36);
};

type GraphScene = Pick<Scene, "id" | "next" | "choices" | "ending">;
const exits = (scene: GraphScene) => scene.choices?.length ? scene.choices.map(choice => choice.next) : scene.ending ? [] : scene.next ? [scene.next] : [];

/** Shortest ending path and longest DAG path. Positive cycles make the upper bound unknown. */
function pathRange(scenes: readonly GraphScene[], start: string, weights: ReadonlyMap<string, number>) {
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  let hasCycle = false;
  let incomplete = false;
  function visit(id: string) {
    if (visiting.has(id)) { hasCycle = true; return; }
    if (reachable.has(id)) return;
    reachable.add(id);
    const scene = byId.get(id);
    if (!scene) { incomplete = true; return; }
    visiting.add(id);
    const targets = exits(scene);
    if (!targets.length && !scene.ending) incomplete = true;
    for (const target of targets) visit(target);
    visiting.delete(id);
    order.push(id);
  }
  visit(start);
  const distance = new Map<string, number>([[start, weights.get(start) ?? 0]]);
  const pending = new Set([start]);
  while (pending.size) {
    const id = [...pending].sort((a, b) => distance.get(a)! - distance.get(b)!)[0]!;
    pending.delete(id);
    const scene = byId.get(id);
    if (!scene) continue;
    for (const target of exits(scene)) {
      const candidate = distance.get(id)! + (weights.get(target) ?? 0);
      if (candidate < (distance.get(target) ?? Infinity)) { distance.set(target, candidate); pending.add(target); }
    }
  }
  const endings = scenes.filter(scene => reachable.has(scene.id) && scene.ending && !scene.choices?.length);
  const min = endings.length ? Math.min(...endings.map(scene => distance.get(scene.id) ?? Infinity)) : null;
  const longest = new Map<string, number>();
  if (!hasCycle) for (const id of order) {
    const scene = byId.get(id)!;
    const targets = exits(scene);
    const tail = targets.length ? Math.max(...targets.map(target => longest.get(target) ?? -Infinity)) : scene.ending ? 0 : -Infinity;
    longest.set(id, (weights.get(id) ?? 0) + tail);
  }
  const maximum = longest.get(start);
  return { min, max: hasCycle || incomplete || maximum === undefined || !Number.isFinite(maximum) ? null : maximum, hasCycle, incomplete, reachable, endingCount: endings.length };
}

export interface DurationEstimate {
  minMinutes: number | null;
  maxMinutes: number | null;
  totalCharacters: number;
  hasCycle: boolean;
  incomplete: boolean;
  endingCount: number;
  reachableScenes: number;
}
export function estimateScriptDuration(script: VnScript, charsPerMinute = DEFAULT_READING_SPEED): DurationEstimate {
  if (!Number.isFinite(charsPerMinute) || charsPerMinute <= 0) throw new Error("읽기 속도는 양수여야 합니다.");
  const weights = new Map(script.scenes.map(scene => [scene.id, sceneCharacters(scene)]));
  const result = pathRange(script.scenes, script.start, weights);
  // Conditional rows are counted only along the choices that actually reveal
  // them. Memoizing scene + flags avoids expanding every repeated merge path.
  if (script.scenes.some(scene => scene.lines.some(line => line.when) || scene.choices?.some(choice=>choice.when||choice.disable||choice.add)) && !result.hasCycle) {
    const memo = new Map<string, { min: number; max: number } | null>();
    const byId = new Map(script.scenes.map(scene => [scene.id, scene]));
    let states = 0, incomplete = result.incomplete;
    const range = (id: string, flags: StoryFlags): { min: number; max: number } | null => {
      const key = id + JSON.stringify(Object.entries(flags).sort(([a],[b])=>a.localeCompare(b)));
      if (memo.has(key)) return memo.get(key)!;
      if (++states > 10000) { incomplete = true; return null; }
      const scene = byId.get(id);
      if (!scene) { incomplete = true; return null; }
      const own = scene.lines.filter(line => lineAllowed(line, flags)).reduce((sum,line)=>sum+countCharacters(line.text),0);
      const tails = scene.choices?.length ? scene.choices.filter(choice=>choiceAllowed(choice,flags)).map(choice=>range(choice.next,applyChoiceFlags(flags,choice))) : scene.ending ? [{min:0,max:0}] : scene.next ? [range(scene.next,flags)] : [];
      if (!tails.length || tails.some(tail=>tail===null)) incomplete = true;
      const valid = tails.filter((tail): tail is {min:number;max:number}=>tail!==null);
      const value = valid.length ? {min:own+Math.min(...valid.map(tail=>tail.min)),max:own+Math.max(...valid.map(tail=>tail.max))} : null;
      memo.set(key,value); return value;
    };
    const conditional = range(script.start,script.flags ?? {});
    return { minMinutes: incomplete || !conditional ? null : conditional.min/charsPerMinute, maxMinutes: incomplete || !conditional ? null : conditional.max/charsPerMinute, totalCharacters:[...weights.values()].reduce((a,b)=>a+b,0), hasCycle:false,incomplete,endingCount:result.endingCount,reachableScenes:result.reachable.size };
  }
  return {
    minMinutes: result.min === null ? null : result.min / charsPerMinute,
    maxMinutes: result.max === null ? null : result.max / charsPerMinute,
    totalCharacters: [...weights.values()].reduce((sum, value) => sum + value, 0),
    hasCycle: result.hasCycle,
    incomplete: result.incomplete || script.scenes.some(scene => result.reachable.has(scene.id) && (!scene.lines.length || scene.lines.some(line => !line.text.trim()))),
    endingCount: result.endingCount,
    reachableScenes: result.reachable.size,
  };
}
export function durationLabel(estimate: Pick<DurationEstimate, "minMinutes" | "maxMinutes">): string {
  if (estimate.minMinutes === null) return "경로 미완성";
  const min = Math.round(estimate.minMinutes * 10) / 10;
  if (estimate.maxMinutes === null) return `${min}분 이상`;
  const max = Math.round(estimate.maxMinutes * 10) / 10;
  return min === max ? `${min}분` : `${min}–${max}분`;
}

export interface SceneBeat {
  id: string;
  chapter: string;
  title: string;
  summary: string;
  artDirection: string;
  targetMinutes: number;
  background: string;
  next?: string;
  choices?: readonly Choice[];
  ending?: string;
}
export interface ProductionOutline {
  title: string;
  subtitle: string;
  bible: string;
  start: string;
  scenes: SceneBeat[];
}
export interface SceneDraft {
  scene: Scene;
  summary: string;
  continuity: string[];
  model: string;
  updatedAt: number;
}
export interface DraftJob {
  status: "pending" | "running" | "ready" | "short" | "error";
  draft?: SceneDraft;
  error?: string;
}
export interface ProductionPlan {
  version: 1;
  id: string;
  baseFingerprint: string;
  baseTitle: string;
  characters: VnScript["characters"];
  sourceArtDirection?: string;
  sourceAssets?: VnScript["assets"];
  brief: string;
  targetMinutes: number;
  charsPerMinute: number;
  outline: ProductionOutline;
  jobs: Record<string, DraftJob>;
  createdAt: number;
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("올바른 JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
};
const requiredText = (value: unknown, label: string, max = 3000): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label}을 확인하세요. (1–${max}자)`);
  return value.trim();
};
function json(text: string) {
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown; }
  catch { throw new Error("AI가 유효한 JSON을 반환하지 않았습니다. 기존 집필 내용은 보존했습니다."); }
}
export function parseOutline(value: unknown, targetMinutes: number): ProductionOutline {
  const raw = object(typeof value === "string" ? json(value) : value);
  if (!Array.isArray(raw["scenes"]) || raw["scenes"].length < 12 || raw["scenes"].length > 60) throw new Error("장편 설계에는 12–60개의 씬이 필요합니다.");
  const scenes: SceneBeat[] = raw["scenes"].map((value: unknown) => {
    const row = object(value);
    const id = requiredText(row["id"], "씬 ID", 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("씬 ID는 영문·숫자·밑줄·하이픈만 사용하세요.");
    const minutes = row["targetMinutes"];
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 1 || minutes > 12) throw new Error("씬별 목표 분량은 1–12분이어야 합니다.");
    const checked = parseScene({ ...row, lines: [{ speaker: null, text: "설계 검증" }] });
    const targets = Number(Boolean(checked.next)) + Number(Boolean(checked.choices?.length)) + Number(Boolean(checked.ending));
    if (targets !== 1) throw new Error("각 씬에는 다음 씬·선택지·엔딩 중 하나의 출구가 필요합니다.");
    if (checked.choices?.some(choice => !choice.text.trim())) throw new Error("선택지 문구가 비어 있습니다.");
    return {
      id,
      chapter: requiredText(row["chapter"], "챕터", 100),
      title: requiredText(row["title"], "씬 제목", 100),
      summary: requiredText(row["summary"], "씬 사건 요약", 900),
      artDirection: requiredText(row["artDirection"], "이미지 연출", 700),
      targetMinutes: minutes,
      background: checked.background,
      ...(checked.next ? { next: requiredText(checked.next, "다음 씬", 80) } : {}),
      ...(checked.choices?.length ? { choices: checked.choices.map(choice => ({ ...choice, text: requiredText(choice.text, "선택지", 160), next: requiredText(choice.next, "선택지 연결", 80) })) } : {}),
      ...(checked.ending ? { ending: requiredText(checked.ending, "엔딩 제목", 150) } : {}),
    };
  });
  const outline: ProductionOutline = { title: requiredText(raw["title"], "제목", 150), subtitle: requiredText(raw["subtitle"], "설명", 400), bible: requiredText(raw["bible"], "작품 설정집", 5000), start: requiredText(raw["start"], "시작 씬", 80), scenes };
  if (new Set(scenes.map(scene => scene.id)).size !== scenes.length) throw new Error("설계에 중복된 씬 ID가 있습니다.");
  const range = pathRange(scenes, outline.start, new Map(scenes.map(scene => [scene.id, scene.targetMinutes])));
  if (range.hasCycle || range.incomplete || range.min === null || range.max === null || range.reachable.size !== scenes.length) throw new Error("설계의 모든 씬은 시작에서 도달하고 반복 없이 엔딩으로 이어져야 합니다.");
  if (range.min < targetMinutes || range.max > targetMinutes * 1.2) throw new Error(`설계의 1회차 분량은 ${range.min}–${range.max}분입니다. 목표 ${targetMinutes}분의 100–120% 범위로 다시 설계하세요.`);
  return outline;
}

const promptCast = (characters: VnScript["characters"]) => characters.map(character => ({ id: character.id, name: character.name.slice(0, 60), bio: character.bio.slice(0, 300) }));
const detachArtwork = (assets: NonNullable<VnScript["assets"]>) => assets.map(({ sceneId: _oldScene, ...asset }) => asset);
export function makeOutlinePrompt(brief: string, targetMinutes: number, script: VnScript) {
  return `당신은 한국어 장편 비주얼 노벨의 책임 작가다. 유효한 JSON만 출력한다. 목표는 독자가 하나의 경로로 엔딩에 도달할 때 ${targetMinutes}분인 작품이다. 모든 분기의 총합을 플레이 시간으로 세지 않는다. 사용자 작품 기획: ${brief.slice(0, 2200)}\n현재 인물(이 ID만 사용): ${JSON.stringify(promptCast(script.characters))}\n배경 ID: ${JSON.stringify(BACKGROUNDS)}\n6개 이상의 챕터, 12–60개 씬(보통 18–24개), 씬마다 3–7분. 공통 이야기와 유의미한 선택지, 적어도 두 엔딩을 구성한다. 모든 시작→엔딩 경로의 targetMinutes 합은 ${targetMinutes}분의 100–120%이고, 분기는 다른 결과를 만들되 초반에 합류시키거나 충분한 길이를 유지한다. 반복·도달 불가능 씬·없는 연결은 금지. 각 씬은 next/choices/ending 중 하나만 사용. 감정 변화, 복선, 갈등, 반전, 결말을 구체적으로 배분. bible은 설정·인물 동기·말투·시간선·복선 회수 원칙이며 3000자 이하. artDirection은 풍부한 배경, 시간대, 조명, 핵심 소품, 카메라, 이벤트 CG 소재를 명시. 출력 스키마: {title:string,subtitle:string,bible:string,start:string,scenes:[{id:"scene_01",chapter:"01. 챕터명",title:string,summary:string,artDirection:string,targetMinutes:number,background:"유효한 배경ID",next?:string,choices?:[{text:string,next:string}],ending?:string}]}. 각 summary는 200자 이하, artDirection은 160자 이하. 아직 대사를 집필하지 말고 장편 전체 설계만 출력.`;
}

export function createPlan(outline: ProductionOutline, base: VnScript, brief: string, targetMinutes: number, charsPerMinute = DEFAULT_READING_SPEED): ProductionPlan {
  return { version: 1, id: crypto.randomUUID(), baseFingerprint: scriptFingerprint(base), baseTitle: base.title, characters: structuredClone(base.characters), ...(base.artDirection ? { sourceArtDirection: base.artDirection } : {}), ...(base.assets ? { sourceAssets: structuredClone(detachArtwork(base.assets)) } : {}), brief, targetMinutes, charsPerMinute, outline, jobs: Object.fromEntries(outline.scenes.map(scene => [scene.id, { status: "pending" as const }])), createdAt: Date.now() };
}

export function makeDraftPrompt(plan: ProductionPlan, beat: SceneBeat, extend = false): string {
  // Only ancestors supply continuity. A sibling branch must never leak events into this route.
  const ancestors = new Set<string>();
  const collect = (id: string) => {
    for (const prior of plan.outline.scenes) if (exits(prior).includes(id) && !ancestors.has(prior.id)) { ancestors.add(prior.id); collect(prior.id); }
  };
  collect(beat.id);
  const prior = plan.outline.scenes.filter(scene => ancestors.has(scene.id)).slice(-10).map(scene => ({ id: scene.id, planned: scene.summary.slice(0, 220), written: plan.jobs[scene.id]?.draft?.summary.slice(0, 300), continuity: plan.jobs[scene.id]?.draft?.continuity.slice(-4).map(fact => fact.slice(0, 140)) }));
  const existing = plan.jobs[beat.id]?.draft;
  const targetCharacters = Math.ceil(beat.targetMinutes * plan.charsPerMinute);
  const remaining = extend && existing ? Math.max(320, targetCharacters - sceneCharacters(existing.scene)) : targetCharacters;
  const compactBeat = { ...beat, title: beat.title.slice(0, 80), chapter: beat.chapter.slice(0, 80), summary: beat.summary.slice(0, 400), artDirection: beat.artDirection.slice(0, 260), ...(beat.choices ? { choices: beat.choices.map(choice => ({ text: choice.text.slice(0, 100), next: choice.next })) } : {}) };
  const prompt = `당신은 한국어 비주얼 노벨 작가다. 유효한 JSON만 출력. 작품 ${plan.outline.title}. 기획: ${plan.brief.slice(0, 900)}\n설정집: ${plan.outline.bible.slice(0, 2500)}\n인물: ${JSON.stringify(promptCast(plan.characters))}\n앞선 조상 씬 맥락(합류점에서는 모든 경로에서 성립하는 사실만 사용): ${JSON.stringify(prior)}\n현재 씬 설계: ${JSON.stringify(compactBeat)}\n${extend && existing ? `분량 보강: 기존 씬의 뒷부분 ${JSON.stringify(existing.scene.lines.slice(-6).map(line => ({ speaker: line.speaker, text: line.text.slice(0, 120) })))}. 기존 대사를 반복하지 말고 결말 직전 상황에서 자연스럽게 이어 쓴다. 기존 대사의 사실관계와 결말을 뒤집지 않는다.` : "이번 씬의 시작부터 다음 연결 직전까지 충분한 사건과 감정 변화로 집필한다."}\n이번 출력 대사 text의 공백 제외 총 글자 수는 최소 ${remaining}, 권장 ${Math.ceil(remaining * 1.1)}자다. ${Math.max(20, Math.ceil(remaining / 48))}줄 이상, 각 줄은 읽기 쉬운 25–85자. 요약·시간 점프로 분량을 생략하거나 같은 문장을 반복하지 않는다. 모든 선택지로 이어질 맥락을 만들고 실제 선택 결과는 다음 씬에 맡긴다. speaker는 ${JSON.stringify(plan.characters.map(character => character.id))} 또는 "me" 또는 null. expression은 neutral/smile/sad/surprised. bgm은 ${JSON.stringify(Object.keys(BGM))}. 출력: {lines:[{speaker,text,expression?,sfx?,shake?}],sprites?:[{slot:"left"|"center"|"right",character:인물ID,expression:"neutral"}],bgm?:string,transition?:"fade"|"dissolve",summary:"이번 씬에서 실제 발생한 사건 250자 이내",continuity:["새로 확인된 사실·소지품·관계·미회수 복선 각각 100자 이내, 최대 5개"]}. scene id/출구/이미지 경로를 만들지 않는다.`;
  // Keep nearest continuity plus the story bible as projects grow. Never exceed the gateway contract.
  let bounded = prompt;
  while (bounded.length > 16000 && prior.length) {
    const previousContext = JSON.stringify(prior);
    prior.shift();
    bounded = bounded.replace(previousContext, JSON.stringify(prior));
  }
  if (bounded.length > 16000) throw new Error("집필 프롬프트가 너무 큽니다. 선택지와 인물 설정을 줄여 주세요.");
  return bounded;
}

export function parseDraft(text: string, plan: ProductionPlan, beat: SceneBeat, model: string, extend = false): DraftJob {
  const raw = object(json(text));
  const lines = parseLines(raw["lines"]);
  if (lines.some(line => !line.text.trim())) throw new Error("AI 초안에 빈 대사가 있습니다.");
  const registered = new Set<string>(plan.characters.map(character => character.id));
  if (lines.some(line => line.speaker && line.speaker !== "me" && !registered.has(line.speaker))) throw new Error("AI 초안에 등록되지 않은 화자가 있습니다.");
  if (lines.length < 8 || sceneCharacters({ lines }) < 200) throw new Error("AI 초안이 너무 짧습니다. 집필 실패로 기록했으며 다시 시도할 수 있습니다.");
  const prior = extend ? plan.jobs[beat.id]?.draft : undefined;
  if (extend && !prior) throw new Error("분량을 보강할 기존 초안이 없습니다.");
  if (prior) {
    const normalize = (text: string) => text.normalize("NFKC").replace(/\s/gu, "");
    const existingText = new Set(prior.scene.lines.map(line => normalize(line.text)));
    if (lines.some(line => countCharacters(line.text) >= 20 && existingText.has(normalize(line.text)))) throw new Error("보강 응답이 기존 원고의 대사를 반복했습니다. 분량을 추가하지 않았습니다. 다시 보강해 주세요.");
  }
  const duplicateCount = lines.length - new Set(lines.map(line => line.text.trim())).size;
  if (duplicateCount > Math.max(3, lines.length * .2)) throw new Error("반복 대사로 분량을 채운 초안입니다. 다시 집필해 주세요.");
  const scene = parseScene({ id: beat.id, chapter: `${beat.chapter} · ${beat.title}`, background: beat.background, artBrief: beat.artDirection, lines: prior ? [...prior.scene.lines, ...lines] : lines,
    ...(raw["sprites"] ? { sprites: raw["sprites"] } : prior?.scene.sprites ? { sprites: prior.scene.sprites } : {}),
    ...(raw["bgm"] ? { bgm: raw["bgm"] } : {}), ...(raw["transition"] ? { transition: raw["transition"] } : { transition: "dissolve" }),
    ...(beat.next ? { next: beat.next } : {}), ...(beat.choices?.length ? { choices: beat.choices } : {}), ...(beat.ending ? { ending: beat.ending } : {}),
  });
  if (scene.sprites?.some(sprite => sprite.character && !registered.has(sprite.character))) throw new Error("AI 초안에 등록되지 않은 배우가 있습니다.");
  const summary = requiredText(raw["summary"], "연속성 요약", 600);
  if (!Array.isArray(raw["continuity"]) || raw["continuity"].length > 8) throw new Error("연속성 기록은 최대 8개 배열이어야 합니다.");
  const continuity = raw["continuity"].map((entry: unknown) => requiredText(entry, "연속성 기록", 200));
  const draft: SceneDraft = { scene, summary: prior ? `${prior.summary} ${summary}`.slice(-600) : summary, continuity: prior ? [...prior.continuity, ...continuity].slice(-8) : continuity, model, updatedAt: Date.now() };
  return { status: sceneCharacters(scene) >= beat.targetMinutes * plan.charsPerMinute ? "ready" : "short", draft };
}

export function planDraftScript(plan: ProductionPlan): VnScript {
  return { title: plan.outline.title, subtitle: plan.outline.subtitle, start: plan.outline.start, characters: plan.characters, ...(plan.sourceArtDirection ? { artDirection: plan.sourceArtDirection } : {}), ...(plan.sourceAssets ? { assets: plan.sourceAssets } : {}), scenes: plan.outline.scenes.map(beat => plan.jobs[beat.id]?.draft?.scene ?? { id: beat.id, background: beat.background, lines: [], ...(beat.next ? { next: beat.next } : {}), ...(beat.choices?.length ? { choices: beat.choices } : {}), ...(beat.ending ? { ending: beat.ending } : {}) }) };
}
export function assembleProduction(plan: ProductionPlan): VnScript {
  if (plan.outline.scenes.some(beat => !plan.jobs[beat.id]?.draft)) throw new Error("모든 씬의 초안을 집필한 뒤 작품에 적용할 수 있습니다.");
  const script = parseScript(planDraftScript(plan));
  const issues = auditScript(script);
  if (issues.length) throw new Error(`원고 검증 실패: ${issues[0]!.message}`);
  return script;
}

/** Reload never silently restarts an API request: running jobs become pending. */
export function restoreProduction(value: unknown): ProductionPlan {
  const row = object(value);
  if (row["version"] !== 1) throw new Error("지원하지 않는 장편 체크포인트 버전입니다.");
  const targetMinutes = row["targetMinutes"];
  const charsPerMinute = row["charsPerMinute"];
  if (typeof targetMinutes !== "number" || targetMinutes < 30 || targetMinutes > 240 || typeof charsPerMinute !== "number" || charsPerMinute < 120 || charsPerMinute > 800) throw new Error("분량 또는 읽기 속도 설정이 올바르지 않습니다.");
  const outline = parseOutline(row["outline"], targetMinutes);
  const sourceAssets = Array.isArray(row["sourceAssets"]) ? row["sourceAssets"].map(value => { const { sceneId: _oldScene, ...asset } = object(value); return asset; }) : row["sourceAssets"];
  const check = parseScript({ title: "checkpoint", subtitle: "", start: "check", characters: row["characters"], ...(row["sourceArtDirection"] ? { artDirection: row["sourceArtDirection"] } : {}), ...(sourceAssets ? { assets: sourceAssets } : {}), scenes: [{ id: "check", background: "title", lines: [{ speaker: null, text: "check" }], ending: "check" }] });
  const rawJobs = object(row["jobs"]);
  const jobs: Record<string, DraftJob> = {};
  for (const beat of outline.scenes) {
    const item = object(rawJobs[beat.id]);
    let draft: SceneDraft | undefined;
    if (item["draft"] !== undefined) {
      const saved = object(item["draft"]);
      const scene = parseScript({ ...check, start: beat.id, scenes: [saved["scene"]] }).scenes[0]!;
      if (scene.id !== beat.id || JSON.stringify(exits(scene)) !== JSON.stringify(exits(beat)) || scene.ending !== beat.ending) throw new Error("체크포인트의 원고 연결이 설계와 다릅니다.");
      if (scene.lines.some(line => !line.text.trim())) throw new Error("체크포인트에 빈 대사가 있습니다.");
      if (!Array.isArray(saved["continuity"]) || saved["continuity"].length > 8) throw new Error("연속성 기록을 읽지 못했습니다.");
      draft = { scene, summary: requiredText(saved["summary"], "요약", 600), continuity: saved["continuity"].map(entry => requiredText(entry, "연속성", 200)), model: typeof saved["model"] === "string" ? saved["model"] : "", updatedAt: typeof saved["updatedAt"] === "number" ? saved["updatedAt"] : 0 };
    }
    const status: DraftJob["status"] = draft ? sceneCharacters(draft.scene) >= beat.targetMinutes * charsPerMinute ? "ready" : "short" : item["status"] === "error" ? "error" : "pending";
    jobs[beat.id] = { status, ...(draft ? { draft } : {}), ...(typeof item["error"] === "string" ? { error: item["error"] } : {}) };
  }
  return { version: 1, id: requiredText(row["id"], "계획 ID", 100), baseFingerprint: requiredText(row["baseFingerprint"], "원본 확인값", 100), baseTitle: requiredText(row["baseTitle"], "원본 제목", 200), characters: check.characters, ...(check.artDirection ? { sourceArtDirection: check.artDirection } : {}), ...(check.assets ? { sourceAssets: check.assets } : {}), brief: requiredText(row["brief"], "기획", 2200), targetMinutes, charsPerMinute, outline, jobs, createdAt: typeof row["createdAt"] === "number" ? row["createdAt"] : Date.now() };
}
