import { BACKGROUNDS, BGM, CHARACTERS, EXPRESSIONS, SFX } from "./manifest.js";
import type { Line, Scene, VnScript } from "./schema.js";

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}: 객체가 필요합니다.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, empty = false): asserts value is string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > 20_000) throw new Error(`${name}: 올바른 텍스트가 필요합니다.`);
}
function member(value: unknown, values: readonly string[], name: string) {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${name}: 지원하지 않는 값입니다.`);
}

/** Imported artwork can only address known local asset roots, without traversal or query strings. */
export function validBackgroundUrl(value: unknown): value is string {
  return typeof value === "string" && (/^\/api\/image\/file\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(value) || /^\/assets\/(?:[a-zA-Z0-9][a-zA-Z0-9_-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(value));
}

export function parseLines(value: unknown): Line[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2000) throw new Error("대사는 1~2,000줄이어야 합니다.");
  for (const item of value) {
    const row = object(item, "대사");
    string(row["text"], "대사", true);
    if (row["speaker"] !== null) member(row["speaker"], [...CHARACTERS, "me"], "화자");
    if (row["expression"] !== undefined) member(row["expression"], EXPRESSIONS, "표정");
    if (row["sfx"] !== undefined) member(row["sfx"], Object.keys(SFX), "효과음");
    if (row["shake"] !== undefined && typeof row["shake"] !== "boolean") throw new Error("흔들림 값이 올바르지 않습니다.");
    if (row["cgUrl"] !== undefined && row["cgUrl"] !== null && !validBackgroundUrl(row["cgUrl"])) throw new Error("대사 CG 주소가 올바르지 않습니다.");
    if (row["backgroundUrl"] !== undefined && !validBackgroundUrl(row["backgroundUrl"])) throw new Error("대사 배경 주소가 올바르지 않습니다.");
  }
  return value as Line[];
}

export function parseScene(value: unknown): Scene {
  const row = object(value, "씬");
  string(row["id"], "씬 ID");
  member(row["background"], Object.keys(BACKGROUNDS), "배경");
  parseLines(row["lines"]);
  for (const key of ["chapter", "ending", "next"] as const) if (row[key] !== undefined) string(row[key], key, key !== "next");
  if (row["bgm"] !== undefined) member(row["bgm"], Object.keys(BGM), "배경음악");
  if (row["backgroundUrl"] !== undefined && !validBackgroundUrl(row["backgroundUrl"])) throw new Error("생성 배경 주소가 올바르지 않습니다.");
  if (row["cgUrl"] !== undefined && !validBackgroundUrl(row["cgUrl"])) throw new Error("이벤트 CG 주소가 올바르지 않습니다.");
  if (row["hideSprites"] !== undefined && typeof row["hideSprites"] !== "boolean") throw new Error("배우 표시 설정이 올바르지 않습니다.");
  if (row["framing"] !== undefined) member(row["framing"], ["wide", "close", "cinematic"], "카메라 프레이밍");
  if (row["artBrief"] !== undefined) string(row["artBrief"], "장면 아트 브리프", true);
  if (row["transition"] !== undefined) member(row["transition"], ["none", "fade", "dissolve", "flash", "fadeToBlack"], "전환");
  if (row["sprites"] !== undefined) {
    if (!Array.isArray(row["sprites"]) || row["sprites"].length > 3) throw new Error("배우 배치가 올바르지 않습니다.");
    const slots = new Set();
    for (const item of row["sprites"]) {
      const sprite = object(item, "배우");
      member(sprite["slot"], ["left", "center", "right"], "배우 위치");
      if (slots.has(sprite["slot"])) throw new Error("같은 위치에 배우를 중복 배치할 수 없습니다.");
      slots.add(sprite["slot"]);
      if (sprite["character"] !== null) member(sprite["character"], CHARACTERS, "배우");
      if (sprite["expression"] !== undefined) member(sprite["expression"], EXPRESSIONS, "배우 표정");
    }
  }
  if (row["choices"] !== undefined) {
    if (!Array.isArray(row["choices"]) || row["choices"].length > 8) throw new Error("선택지는 최대 8개까지 지원합니다.");
    for (const item of row["choices"]) {
      const choice = object(item, "선택지");
      string(choice["text"], "선택지 텍스트", true);
      string(choice["next"], "선택지 연결");
      if (choice["affection"] !== undefined && (typeof choice["affection"] !== "number" || !Number.isFinite(choice["affection"]))) throw new Error("호감도 값이 올바르지 않습니다.");
    }
  }
  return value as Scene;
}

export function parseScript(value: unknown): VnScript {
  const row = object(value, "작품");
  string(row["title"], "작품 제목");
  string(row["subtitle"], "작품 설명", true);
  string(row["start"], "시작 씬");
  if (!Array.isArray(row["characters"]) || row["characters"].length > 3) throw new Error("등장인물 목록이 올바르지 않습니다.");
  const characters = new Set();
  for (const item of row["characters"]) {
    const character = object(item, "등장인물");
    member(character["id"], CHARACTERS, "등장인물 ID");
    if (characters.has(character["id"])) throw new Error("등장인물 ID가 중복됩니다.");
    characters.add(character["id"]);
    string(character["name"], "등장인물 이름");
    string(character["bio"], "등장인물 설명", true);
    if (character["chromaKey"] !== undefined && character["chromaKey"] !== "#00ff00") throw new Error("지원하지 않는 캐릭터 크로마키입니다.");
    if (character["expressionImages"] !== undefined) {
      const images = object(character["expressionImages"], "캐릭터 이미지");
      for (const [expression, url] of Object.entries(images)) {
        member(expression, EXPRESSIONS, "캐릭터 이미지 표정");
        if (!validBackgroundUrl(url)) throw new Error("캐릭터 이미지 주소가 올바르지 않습니다.");
      }
    }
    if (typeof character["color"] !== "string" || !/^#[a-f0-9]{6}$/i.test(character["color"])) throw new Error("이름표 색상이 올바르지 않습니다.");
  }
  if (!Array.isArray(row["scenes"]) || row["scenes"].length === 0 || row["scenes"].length > 300) throw new Error("작품에는 1~300개의 씬이 필요합니다.");
  const ids = new Set();
  for (const item of row["scenes"]) {
    const scene = parseScene(item);
    if (ids.has(scene.id)) throw new Error(`중복된 씬 ID: ${scene.id}`);
    ids.add(scene.id);
    for (const line of scene.lines) if (line.speaker && line.speaker !== "me" && !characters.has(line.speaker)) throw new Error(`등록되지 않은 화자: ${line.speaker}`);
    for (const sprite of scene.sprites ?? []) if (sprite.character && !characters.has(sprite.character)) throw new Error(`등록되지 않은 배우: ${sprite.character}`);
  }
  if (!ids.has(row["start"])) throw new Error("시작 씬을 찾을 수 없습니다.");
  if (row["artDirection"] !== undefined) string(row["artDirection"], "아트 디렉션", true);
  if (row["assetLibraryMode"] !== undefined) member(row["assetLibraryMode"], ["project", "all"], "아트 라이브러리 범위");
  if (row["assets"] !== undefined) {
    if (!Array.isArray(row["assets"]) || row["assets"].length > 2_000) throw new Error("아트 라이브러리는 최대 2,000개입니다.");
    const assetIds = new Set<string>();
    for (const item of row["assets"]) {
      const asset = object(item, "아트 에셋");
      string(asset["id"], "에셋 ID");
      if (assetIds.has(asset["id"])) throw new Error("에셋 ID가 중복됩니다.");
      assetIds.add(asset["id"]);
      string(asset["name"], "에셋 이름");
      member(asset["kind"], ["background", "cg", "character"], "에셋 종류");
      if (!validBackgroundUrl(asset["url"])) throw new Error("에셋 이미지 주소가 올바르지 않습니다.");
      for (const key of ["prompt", "createdAt", "sceneId"] as const) if (asset[key] !== undefined) string(asset[key], `에셋 ${key}`, key === "prompt");
      if (asset["sceneId"] !== undefined && !ids.has(asset["sceneId"])) throw new Error("에셋의 대상 씬을 찾을 수 없습니다.");
      if (asset["characterId"] !== undefined && !characters.has(asset["characterId"])) throw new Error("에셋의 등장인물을 찾을 수 없습니다.");
      if (asset["expression"] !== undefined) member(asset["expression"], EXPRESSIONS, "에셋 표정");
      if (asset["kind"] === "character" && asset["characterId"] === undefined) throw new Error("캐릭터 에셋에는 등장인물이 필요합니다.");
    }
  }
  return value as VnScript;
}

export interface StoryIssue { readonly sceneId: string; readonly message: string; readonly severity: "error" | "warning" }
export function auditScript(script: VnScript): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const ids = new Set(script.scenes.map(scene => scene.id));
  const reachable = new Set<string>();
  const pending = [script.start];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const scene = script.scenes.find(row => row.id === id);
    if (!scene) continue;
    pending.push(...(scene.choices?.length ? scene.choices.map(choice => choice.next) : scene.ending ? [] : scene.next ? [scene.next] : []));
  }
  for (const scene of script.scenes) {
    const add = (message: string, severity: StoryIssue["severity"] = "error") => issues.push({ sceneId: scene.id, message, severity });
    if (scene.lines.some(line => !line.text.trim())) add("빈 대사가 있습니다.");
    if (!scene.choices?.length && !scene.next && !scene.ending) add("다음 씬이나 엔딩을 연결하세요.");
    if (scene.next && !ids.has(scene.next)) add("다음 씬을 찾을 수 없습니다.");
    for (const choice of scene.choices ?? []) {
      if (!ids.has(choice.next)) add("선택지가 없는 씬으로 연결됩니다.");
      if (!choice.text.trim()) add("빈 선택지가 있습니다.");
    }
    if (scene.choices?.length && (scene.next || scene.ending)) add("선택지가 다음 씬·엔딩 설정보다 우선합니다.", "warning");
    if (!reachable.has(scene.id)) add("시작 씬에서 도달할 수 없습니다.", "warning");
  }
  const canFinish = new Set(script.scenes.filter(scene => scene.ending && !scene.choices?.length).map(scene => scene.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const scene of script.scenes) {
      const targets = scene.choices?.length ? scene.choices.map(choice => choice.next) : scene.next ? [scene.next] : [];
      if (!canFinish.has(scene.id) && targets.some(id => canFinish.has(id))) { canFinish.add(scene.id); changed = true; }
    }
  }
  for (const scene of script.scenes) if (reachable.has(scene.id) && !canFinish.has(scene.id)) issues.push({ sceneId: scene.id, message: "이 씬에서 도달 가능한 엔딩이 없습니다.", severity: "warning" });
  return issues;
}
