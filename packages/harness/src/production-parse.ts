import { parseLines, parseScene } from "../../content/src/index.js";
import { countCharacters, sceneCharacters } from "./production-duration.js";
import { pathRange, sceneExits } from "./production-graph.js";
import { parseJsonBlob, requiredObject, requiredText } from "./production-json.js";
import { PRODUCTION_SCENE_LIMITS } from "./production-limits.js";
import type { ProductionPlan, ProductionTiming, SceneBeat, SceneDraft, StudioOutline } from "./production-types.js";
import type { DraftJob } from "./production-types.js";

export function parseOutline(value: unknown, targetMinutes: number): StudioOutline {
  const raw = requiredObject(typeof value === "string" ? parseJsonBlob(value) : value);
  const rows = raw["scenes"];
  if (!Array.isArray(rows) || rows.length < PRODUCTION_SCENE_LIMITS.min || rows.length > PRODUCTION_SCENE_LIMITS.max) {
    throw new Error(`장편 설계에는 ${PRODUCTION_SCENE_LIMITS.min}–${PRODUCTION_SCENE_LIMITS.max}개의 씬이 필요합니다.`);
  }
  const scenes: SceneBeat[] = rows.map((entry: unknown) => {
    const row = requiredObject(entry);
    const id = requiredText(row["id"], "씬 ID", 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("씬 ID는 영문·숫자·밑줄·하이픈만 사용하세요.");
    const minutes = row["targetMinutes"];
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 1 || minutes > 12) {
      throw new Error("씬별 목표 분량은 1–12분이어야 합니다.");
    }
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
      ...(checked.choices?.length
        ? { choices: checked.choices.map(choice => ({ ...choice, text: requiredText(choice.text, "선택지", 160), next: requiredText(choice.next, "선택지 연결", 80) })) }
        : {}),
      ...(checked.ending ? { ending: requiredText(checked.ending, "엔딩 제목", 150) } : {}),
    };
  });
  const outline: StudioOutline = {
    title: requiredText(raw["title"], "제목", 150),
    subtitle: requiredText(raw["subtitle"], "설명", 400),
    bible: requiredText(raw["bible"], "작품 설정집", 5000),
    start: requiredText(raw["start"], "시작 씬", 80),
    scenes,
  };
  if (new Set(scenes.map(scene => scene.id)).size !== scenes.length) throw new Error("설계에 중복된 씬 ID가 있습니다.");
  const range = pathRange(scenes, outline.start, new Map(scenes.map(scene => [scene.id, scene.targetMinutes])));
  if (range.hasCycle || range.incomplete || range.min === null || range.max === null || range.reachable.size !== scenes.length) {
    throw new Error("설계의 모든 씬은 시작에서 도달하고 반복 없이 엔딩으로 이어져야 합니다.");
  }
  if (range.min < targetMinutes || range.max > targetMinutes * 1.2) {
    throw new Error(`설계의 1회차 분량은 ${range.min}–${range.max}분입니다. 목표 ${targetMinutes}분의 100–120% 범위로 다시 설계하세요.`);
  }
  return outline;
}

export function parseDraft(
  text: string, plan: ProductionPlan, beat: SceneBeat, model: string, extend: boolean, timing: ProductionTiming,
): DraftJob {
  const raw = requiredObject(parseJsonBlob(text));
  const lines = parseLines(raw["lines"]);
  if (lines.some(line => !line.text.trim())) throw new Error("AI 초안에 빈 대사가 있습니다.");
  const registered = new Set<string>(plan.characters.map(character => character.id));
  if (lines.some(line => line.speaker && line.speaker !== "me" && !registered.has(line.speaker))) {
    throw new Error("AI 초안에 등록되지 않은 화자가 있습니다.");
  }
  if (lines.length < 8 || sceneCharacters({ lines }) < 200) {
    throw new Error("AI 초안이 너무 짧습니다. 집필 실패로 기록했으며 다시 시도할 수 있습니다.");
  }
  const prior = extend ? plan.jobs[beat.id]?.draft : undefined;
  if (extend && !prior) throw new Error("분량을 보강할 기존 초안이 없습니다.");
  if (prior) {
    const normalize = (value: string) => value.normalize("NFKC").replace(/\s/gu, "");
    const existingText = new Set(prior.scene.lines.map(line => normalize(line.text)));
    if (lines.some(line => countCharacters(line.text) >= 20 && existingText.has(normalize(line.text)))) {
      throw new Error("보강 응답이 기존 원고의 대사를 반복했습니다. 분량을 추가하지 않았습니다. 다시 보강해 주세요.");
    }
  }
  const duplicateCount = lines.length - new Set(lines.map(line => line.text.trim())).size;
  if (duplicateCount > Math.max(3, lines.length * 0.2)) throw new Error("반복 대사로 분량을 채운 초안입니다. 다시 집필해 주세요.");
  const scene = parseScene({
    id: beat.id, chapter: `${beat.chapter} · ${beat.title}`, background: beat.background, artBrief: beat.artDirection,
    lines: prior ? [...prior.scene.lines, ...lines] : lines,
    ...(raw["sprites"] ? { sprites: raw["sprites"] } : prior?.scene.sprites ? { sprites: prior.scene.sprites } : {}),
    ...(raw["bgm"] ? { bgm: raw["bgm"] } : {}),
    ...(raw["transition"] ? { transition: raw["transition"] } : { transition: "dissolve" }),
    ...(beat.next ? { next: beat.next } : {}),
    ...(beat.choices?.length ? { choices: beat.choices } : {}),
    ...(beat.ending ? { ending: beat.ending } : {}),
  });
  if (scene.sprites?.some(sprite => sprite.character && !registered.has(sprite.character))) {
    throw new Error("AI 초안에 등록되지 않은 배우가 있습니다.");
  }
  const summary = requiredText(raw["summary"], "연속성 요약", 600);
  const continuityRaw = raw["continuity"];
  if (!Array.isArray(continuityRaw) || continuityRaw.length > 8) throw new Error("연속성 기록은 최대 8개 배열이어야 합니다.");
  const continuity = continuityRaw.map((entry: unknown) => requiredText(entry, "연속성 기록", 200));
  const draft: SceneDraft = {
    scene,
    summary: prior ? `${prior.summary} ${summary}`.slice(-600) : summary,
    continuity: prior ? [...prior.continuity, ...continuity].slice(-8) : continuity,
    model,
    updatedAt: timing.now(),
  };
  return { status: sceneCharacters(scene) >= beat.targetMinutes * plan.charsPerMinute ? "ready" : "short", draft };
}

export { sceneExits };
