import { BACKGROUNDS, BGM, CHARACTERS, EXPRESSIONS, SFX } from "./manifest.js";
import type { Line, Scene, SpriteDirection, VnScript } from "./schema.js";
import { validCharacterKey } from "./characters.js";
import { choiceAllowed, choiceEffectError, applyChoiceFlags, lineAllowed } from "./conditions.js";
import { validAudioUrl } from "./audio.js";

/** Authoring limits shared by the parser and the studio UI. The parser stays the source of truth; the editor uses these to refuse or cap input before it becomes unsaveable. */
export const LIMITS = { text: 20_000, sceneLines: 2000, scenes: 300, choices: 8, routes: 16, flags: 100, characters: 200 } as const;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}: 객체가 필요합니다.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, empty = false): asserts value is string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > LIMITS.text) throw new Error(`${name}: 올바른 텍스트가 필요합니다.`);
}
function member(value: unknown, values: readonly string[], name: string) {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${name}: 지원하지 않는 값입니다.`);
}
function characterKey(value: unknown, name: string) { if(!validCharacterKey(value))throw new Error(`${name}: 영문자로 시작하는 64자 이하의 영문·숫자·하이픈·밑줄 ID가 필요합니다.`); }

const WEATHER_EFFECTS = ["rain", "snow", "petals", "embers", "dust"] as const;
/** 틴트는 CSS hex 색만 받는다 — 임의 CSS 를 허용하면 원고가 플레이어 스타일을 주입할 수 있다. */
const TINT_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function effect(value: unknown, name: string) { if (value !== null) member(value, WEATHER_EFFECTS, name); }
function tint(value: unknown, name: string) { if (value !== null && (typeof value !== "string" || !TINT_COLOR.test(value))) throw new Error(`${name}: "#rrggbb" 형태의 색 값이 필요합니다.`); }
function input(value: unknown) {
  const row = object(value, "독자 입력");
  flagName(row["flag"]);
  for (const key of ["prompt", "placeholder"] as const) if (row[key] !== undefined) string(row[key], `독자 입력 ${key}`, true);
  if (row["max"] !== undefined && (typeof row["max"] !== "number" || !Number.isInteger(row["max"]) || row["max"] < 1 || row["max"] > 200)) throw new Error("독자 입력 길이는 1~200 사이 정수여야 합니다.");
}

/** 선택 기억 이름 규칙 — IR 그래프의 when/set 파서도 같은 검증을 쓴다. */
export function validFlagName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(value) && !["constructor", "prototype", "__proto__"].includes(value);
}
function flagName(value: unknown) {
  if (!validFlagName(value)) throw new Error("선택 기억 이름이 올바르지 않습니다.");
}
function flags(value: unknown) {
  const row = object(value, "선택 기억");
  if (Object.keys(row).length > 100) throw new Error("선택 기억은 최대 100개입니다.");
  for (const [key, value] of Object.entries(row)) {
    flagName(key);
    if (!(typeof value === "boolean" || typeof value === "string" && value.length <= 200 || typeof value === "number" && Number.isFinite(value))) throw new Error("선택 기억 값이 올바르지 않습니다.");
  }
}
function condition(value: unknown) {
  const row=object(value,"표시 조건");
  if(Object.keys(row).some(key=>!["all","none","compare"].includes(key)))throw new Error("지원하지 않는 표시 조건입니다.");
  for(const key of ["all","none"])if(row[key]!==undefined){
    const names=row[key];if(!Array.isArray(names)||names.length>100)throw new Error("표시 조건은 최대 100개입니다.");
    names.forEach(flagName);
  }
  if(row["compare"]!==undefined){
    const rows=row["compare"];if(!Array.isArray(rows)||rows.length>100)throw new Error("비교 조건은 최대 100개입니다.");
    for(const item of rows){
      const rule=object(item,"비교 조건");flagName(rule["flag"]);member(rule["op"],["eq","ne","gt","gte","lt","lte"],"비교 연산");
      flags({value:rule["value"]});
      if(!["eq","ne"].includes(rule["op"] as string)&&typeof rule["value"]!=="number")throw new Error("크기 비교에는 숫자가 필요합니다.");
    }
  }
}

/** 구조화 표시 조건 {all, none, compare} 를 검증해 돌려준다. IR 그래프의 when 파서도 이걸 쓴다. */
export function parseCondition(value: unknown): import("./schema.js").LineCondition {
  condition(value);
  return value as import("./schema.js").LineCondition;
}
function sprites(value: unknown) {
  if (!Array.isArray(value) || value.length > 3) throw new Error("배우 배치가 올바르지 않습니다.");
  const slots = new Set();
  for (const item of value) {
    const sprite = object(item, "배우");
    member(sprite["slot"], ["left", "center", "right"], "배우 위치");
    if (slots.has(sprite["slot"])) throw new Error("같은 위치에 배우를 중복 배치할 수 없습니다.");
    slots.add(sprite["slot"]);
    if (sprite["character"] !== null) characterKey(sprite["character"], "배우");
    if (sprite["expression"] !== undefined) characterKey(sprite["expression"], "배우 표정");
    if (sprite["outfit"] !== undefined && sprite["outfit"] !== null) characterKey(sprite["outfit"], "배우 의상");
    if (sprite["poseUrl"] !== undefined && sprite["poseUrl"] !== null && !validBackgroundUrl(sprite["poseUrl"])) throw new Error("배우 포즈 주소가 올바르지 않습니다.");
  }
}

/** Imported artwork can only address known local asset roots, without traversal or query strings. */
export function validBackgroundUrl(value: unknown): value is string {
  return typeof value === "string" && (/^\/api\/image\/file\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(value) || /^\/assets\/(?:[a-zA-Z0-9][a-zA-Z0-9_-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(value));
}

function narrativeId(value:unknown,seen:Set<string>,kind:string):void {
  if(value===undefined)return;
  if(typeof value!=="string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value))throw new Error(`${kind} ID는 영문·숫자·밑줄·하이픈으로 된 1~96자여야 합니다.`);
  if(seen.has(value))throw new Error(`같은 장면 안에 ${kind} ID가 중복되었습니다.`);
  seen.add(value);
}

export function parseLines(value: unknown): Line[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.sceneLines) throw new Error("대사는 1~2,000줄이어야 합니다.");
  const ids=new Set<string>();
  for (const item of value) {
    const row = object(item, "대사");
    narrativeId(row["id"],ids,"대사");
    string(row["text"], "대사", true);
    if (row["speaker"] !== null) characterKey(row["speaker"], "화자");
    if (row["expression"] !== undefined) characterKey(row["expression"], "표정");
    if (row["sfx"] !== undefined && !validAudioUrl(row["sfx"])) member(row["sfx"], Object.keys(SFX), "효과음");
    if (row["voice"] !== undefined && !validAudioUrl(row["voice"])) throw new Error("보이스 파일 주소가 올바르지 않습니다.");
    if (row["shake"] !== undefined && typeof row["shake"] !== "boolean") throw new Error("흔들림 값이 올바르지 않습니다.");
    if (row["cgHide"] !== undefined && typeof row["cgHide"] !== "boolean") throw new Error("CG 숨김 값이 올바르지 않습니다.");
    if (row["cgUrl"] !== undefined && row["cgUrl"] !== null && !validBackgroundUrl(row["cgUrl"])) throw new Error("대사 CG 주소가 올바르지 않습니다.");
    if (row["backgroundUrl"] !== undefined && !validBackgroundUrl(row["backgroundUrl"])) throw new Error("대사 배경 주소가 올바르지 않습니다.");
    if (row["sprites"] !== undefined) sprites(row["sprites"]);
    if (row["framing"] !== undefined) member(row["framing"], ["wide", "close", "cinematic"], "대사 카메라");
    if (row["bgm"] !== undefined && row["bgm"] !== null && !validAudioUrl(row["bgm"])) member(row["bgm"], Object.keys(BGM), "대사 음악");
    if (row["when"] !== undefined) condition(row["when"]);
    if (row["effect"] !== undefined) effect(row["effect"], "대사 입자 연출");
    if (row["tint"] !== undefined) tint(row["tint"], "대사 틴트");
    if (row["input"] !== undefined) input(row["input"]);
  }
  return value as Line[];
}

export function parseScene(value: unknown): Scene {
  const row = object(value, "씬");
  string(row["id"], "씬 ID");
  member(row["background"], Object.keys(BACKGROUNDS), "배경");
  parseLines(row["lines"]);
  for (const key of ["chapter", "ending", "next"] as const) if (row[key] !== undefined) string(row[key], key, key !== "next");
  if (row["bgm"] !== undefined && !validAudioUrl(row["bgm"])) member(row["bgm"], Object.keys(BGM), "배경음악");
  if (row["backgroundUrl"] !== undefined && !validBackgroundUrl(row["backgroundUrl"])) throw new Error("생성 배경 주소가 올바르지 않습니다.");
  if (row["cgUrl"] !== undefined && !validBackgroundUrl(row["cgUrl"])) throw new Error("이벤트 CG 주소가 올바르지 않습니다.");
  if (row["cg"] !== undefined) string(row["cg"], "이벤트 CG");
  if (row["cg"] !== undefined && row["cgUrl"] !== undefined) throw new Error("이벤트 CG는 cg(에셋)와 cgUrl(주소) 중 하나만 지정할 수 있습니다.");
  if (row["hideSprites"] !== undefined && typeof row["hideSprites"] !== "boolean") throw new Error("배우 표시 설정이 올바르지 않습니다.");
  if (row["framing"] !== undefined) member(row["framing"], ["wide", "close", "cinematic"], "카메라 프레이밍");
  if (row["artBrief"] !== undefined) string(row["artBrief"], "장면 아트 브리프", true);
  if (row["transition"] !== undefined) member(row["transition"], ["none", "fade", "dissolve", "flash", "fadeToBlack"], "전환");
  if (row["effect"] !== undefined) member(row["effect"], WEATHER_EFFECTS, "장면 입자 연출");
  if (row["tint"] !== undefined) tint(row["tint"], "장면 틴트");
  if (row["sprites"] !== undefined) sprites(row["sprites"]);
  if (row["set"] !== undefined) flags(row["set"]);
  if (row["routes"] !== undefined) {
    if (!Array.isArray(row["routes"]) || row["routes"].length === 0 || row["routes"].length > LIMITS.routes) throw new Error(`조건부 경로는 1~${LIMITS.routes}개입니다.`);
    for (const item of row["routes"]) {
      const route = object(item, "조건부 경로");
      string(route["next"], "경로 연결");
      if (route["when"] !== undefined) condition(route["when"]);
    }
  }
  if (row["choices"] !== undefined) {
    if (!Array.isArray(row["choices"]) || row["choices"].length > LIMITS.choices) throw new Error("선택지는 최대 8개까지 지원합니다.");
    const choiceIds=new Set<string>();
    for (const item of row["choices"]) {
      const choice = object(item, "선택지");
      narrativeId(choice["id"],choiceIds,"선택지");
      string(choice["text"], "선택지 텍스트", true);
      string(choice["next"], "선택지 연결");
      if (choice["affection"] !== undefined && (typeof choice["affection"] !== "number" || !Number.isFinite(choice["affection"]))) throw new Error("호감도 값이 올바르지 않습니다.");
      if (choice["set"] !== undefined) flags(choice["set"]);
      if(choice["add"]!==undefined){flags(choice["add"]);for(const [key,delta] of Object.entries(choice["add"] as Record<string,unknown>)){if(typeof delta!=="number")throw new Error("선택지 증감 값은 숫자여야 합니다.");if(Object.hasOwn((choice["set"]??{}) as object,key))throw new Error("같은 변수에 고정값 설정과 증감을 동시에 지정할 수 없습니다.");}}
      if (choice["when"] !== undefined) condition(choice["when"]);
      if (choice["cond"] !== undefined && choice["cond"] !== "") throw new Error("선택지 cond 표현식은 지원하지 않습니다. 구조화된 when 조건을 사용하세요.");
      if (choice["disable"] !== undefined && typeof choice["disable"] !== "boolean") throw new Error("선택지 잠금 값이 올바르지 않습니다.");
    }
  }
  return value as Scene;
}

export function parseScript(value: unknown): VnScript {
  const row = object(value, "작품");
  if(row["musicFadeSeconds"]!==undefined&&(typeof row["musicFadeSeconds"]!=="number"||!Number.isFinite(row["musicFadeSeconds"])||row["musicFadeSeconds"]<0||row["musicFadeSeconds"]>10))throw new Error("음악 페이드는 0~10초의 유한한 숫자여야 합니다.");
  string(row["title"], "작품 제목");
  if (row["titleBgm"] !== undefined && !validAudioUrl(row["titleBgm"])) member(row["titleBgm"], Object.keys(BGM), "타이틀 음악");
  if (row["nativeSaveId"] !== undefined && (typeof row["nativeSaveId"] !== "string" || !/^[a-f0-9]{16}(?:[a-f0-9]{16})?$/.test(row["nativeSaveId"]))) throw new Error("네이티브 배포 ID는 16자리 또는 32자리 소문자 16진수여야 합니다.");
  string(row["subtitle"], "작품 설명", true);
  if (row["credits"] !== undefined) {
    if (!Array.isArray(row["credits"]) || row["credits"].length > 100) throw new Error("제작진 크레딧은 최대 100개입니다.");
    for (const value of row["credits"]) {
      const credit = object(value, "제작진 크레딧");
      for (const [key, max] of [["role", 120], ["names", 4000]] as const) {
        if (typeof credit[key] !== "string" || credit[key].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(credit[key])) throw new Error(`제작진 ${key}: ${max}자 이하의 텍스트가 필요합니다.`);
      }
      if (Object.keys(credit).some(key => key !== "role" && key !== "names")) throw new Error("지원하지 않는 제작진 크레딧 항목입니다.");
    }
  }
  string(row["start"], "시작 씬");
  if (row["flags"] !== undefined) flags(row["flags"]);
  if(row["audioAssets"]!==undefined){
    const assets=row["audioAssets"];if(!Array.isArray(assets)||assets.length>5000)throw new Error("음원 보관함은 최대 5,000개입니다.");
    const ids=new Set();for(const value of assets){const asset=object(value,"음원");string(asset["id"],"음원 ID");if(ids.has(asset["id"]))throw new Error("음원 ID가 중복됩니다.");ids.add(asset["id"]);string(asset["name"],"음원 이름");member(asset["kind"],["bgm","sfx","voice"],"음원 종류");if(!validAudioUrl(asset["url"]))throw new Error("음원 주소가 올바르지 않습니다.");if(typeof asset["duration"]!=="number"||!Number.isFinite(asset["duration"])||asset["duration"]<=0||asset["duration"]>1800)throw new Error("음원은 파일당 30분 이하여야 합니다.");}
  }
  if (!Array.isArray(row["characters"]) || row["characters"].length > 200) throw new Error("등장인물은 최대 200명입니다.");
  const characters = new Set();
  const outfitSets = new Map<string, Set<string>>();
  for (const item of row["characters"]) {
    const character = object(item, "등장인물");
    characterKey(character["id"], "등장인물 ID");
    if (characters.has(character["id"])) throw new Error("등장인물 ID가 중복됩니다.");
    characters.add(character["id"]);
    outfitSets.set(character["id"] as string, new Set((character["outfits"] as string[] | undefined) ?? []));
    string(character["name"], "등장인물 이름");
    string(character["bio"], "등장인물 설명", true);
    if (character["chromaKey"] !== undefined && character["chromaKey"] !== "#00ff00") throw new Error("지원하지 않는 캐릭터 크로마키입니다.");
    if (character["expressionImages"] !== undefined) {
      const images = object(character["expressionImages"], "캐릭터 이미지");
      for (const [expression, url] of Object.entries(images)) {
        characterKey(expression, "캐릭터 이미지 표정");
        if (!validBackgroundUrl(url)) throw new Error("캐릭터 이미지 주소가 올바르지 않습니다.");
      }
    }
    if (character["outfits"] !== undefined) {
      const outfits = character["outfits"];
      if (!Array.isArray(outfits) || outfits.length > 20) throw new Error("의상은 최대 20벌입니다.");
      const seen = new Set<string>();
      for (const outfit of outfits) {
        characterKey(outfit, "의상");
        if (seen.has(outfit as string)) throw new Error("의상 ID가 중복됩니다.");
        seen.add(outfit as string);
      }
    }
    if (character["outfitImages"] !== undefined) {
      const declared = new Set((character["outfits"] as string[] | undefined) ?? []);
      const table = object(character["outfitImages"], "캐릭터 의상 이미지");
      for (const [outfit, images] of Object.entries(table)) {
        if (!declared.has(outfit)) throw new Error(`선언되지 않은 의상 이미지입니다: ${outfit}`);
        const row = object(images, "의상 이미지");
        if (Object.keys(row).length > 40) throw new Error("의상당 이미지는 최대 40개입니다.");
        for (const [expression, url] of Object.entries(row)) {
          characterKey(expression, "의상 이미지 표정");
          if (!validBackgroundUrl(url)) throw new Error("의상 이미지 주소가 올바르지 않습니다.");
        }
      }
    }
    if (typeof character["color"] !== "string" || !/^#[a-f0-9]{6}$/i.test(character["color"])) throw new Error("이름표 색상이 올바르지 않습니다.");
  }
  if (!Array.isArray(row["scenes"]) || row["scenes"].length === 0 || row["scenes"].length > LIMITS.scenes) throw new Error("작품에는 1~300개의 씬이 필요합니다.");
  const ids = new Set();
  for (const item of row["scenes"]) {
    const scene = parseScene(item);
    if (ids.has(scene.id)) throw new Error(`중복된 씬 ID: ${scene.id}`);
    ids.add(scene.id);
    const checkSprite = (sprite: SpriteDirection) => {
      if (sprite.character && !characters.has(sprite.character)) throw new Error(`등록되지 않은 배우: ${sprite.character}`);
      if (typeof sprite.outfit === "string" && sprite.character && !outfitSets.get(sprite.character)?.has(sprite.outfit)) throw new Error(`선언되지 않은 의상입니다: ${sprite.outfit}`);
    };
    for (const sprite of scene.sprites ?? []) checkSprite(sprite);
    for (const line of scene.lines) {
      if (line.speaker && line.speaker !== "me" && !characters.has(line.speaker)) throw new Error(`등록되지 않은 화자: ${line.speaker}`);
      for (const sprite of line.sprites ?? []) checkSprite(sprite);
    }
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
      if (asset["expression"] !== undefined) characterKey(asset["expression"], "에셋 표정");
    }
  }
  // scene.cg 는 assets 배열 유무와 무관하게 검증한다 — assets 없는 원고의 cg 는 조용히 무시된다.
  const cgAssets = new Set(((row["assets"] as { id: string; kind: string }[] | undefined) ?? []).filter(asset => asset.kind === "cg").map(asset => asset.id));
  for (const item of row["scenes"] as { id: string; cg?: string }[]) {
    if (item.cg !== undefined && !cgAssets.has(item.cg)) throw new Error(`씬 ${item.id}: 이벤트 CG 에셋을 찾을 수 없습니다: ${item.cg}`);
  }
  for (const asset of [...(row["assets"] as Record<string, unknown>[] | undefined ?? []), ...(row["audioAssets"] as Record<string, unknown>[] | undefined ?? [])]) {
    if (asset["provenance"] === undefined) continue;
    const record = object(asset["provenance"], "소재 출처");
    for (const key of Object.keys(record)) {
      if (!["creator", "source", "license", "credit"].includes(key)) throw new Error("소재 출처 항목이 올바르지 않습니다.");
      const field = record[key];
      if (typeof field !== "string" || field.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(field)) throw new Error("소재 출처는 항목당 4,000자 이내의 텍스트여야 합니다.");
    }
  }
  return value as VnScript;
}

export interface StoryIssue { readonly sceneId: string; readonly message: string; readonly severity: "error" | "warning" }

/** 엔진의 출구 우선순위와 같다 — 선택지가 있으면 그것만, 없으면 조건 경로와 기본 next 가 모두 도달 후보다. */
function exits(scene: Scene): string[] {
  if (scene.choices?.length) return scene.choices.map(choice => choice.next);
  return [...(scene.routes ?? []).map(route => route.next), ...(scene.next ? [scene.next] : [])];
}

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
    pending.push(...exits(scene));
  }
  for (const scene of script.scenes) {
    const add = (message: string, severity: StoryIssue["severity"] = "error") => issues.push({ sceneId: scene.id, message, severity });
    if (scene.lines.some(line => !line.text.trim())) add("빈 대사가 있습니다.");
    if (!scene.choices?.length && !scene.routes?.length && !scene.next && !scene.ending) add("다음 씬이나 엔딩을 연결하세요.");
    if (scene.next && !ids.has(scene.next)) add("다음 씬을 찾을 수 없습니다.");
    for (const route of scene.routes ?? []) {
      if (!ids.has(route.next)) add("조건부 경로가 없는 씬으로 연결됩니다.");
    }
    for (const choice of scene.choices ?? []) {
      if (!ids.has(choice.next)) add("선택지가 없는 씬으로 연결됩니다.");
      if (!choice.text.trim()) add("빈 선택지가 있습니다.");
    }
    if (scene.choices?.length && (scene.routes?.length || scene.next || scene.ending)) add("선택지가 경로·다음 씬·엔딩 설정보다 우선합니다.", "warning");
    if (scene.ending && scene.next) add("엔딩이 다음 씬보다 우선합니다 — 다음 씬은 실행되지 않습니다.", "warning");
    if (!reachable.has(scene.id)) add("시작 씬에서 도달할 수 없습니다.", "warning");
  }
  const canFinish = new Set(script.scenes.filter(scene => scene.ending && !scene.choices?.length).map(scene => scene.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const scene of script.scenes) {
      const targets = exits(scene);
      if (!canFinish.has(scene.id) && targets.some(id => canFinish.has(id))) { canFinish.add(scene.id); changed = true; }
    }
  }
  for (const scene of script.scenes) if (reachable.has(scene.id) && !canFinish.has(scene.id)) issues.push({ sceneId: scene.id, message: "이 씬에서 도달 가능한 엔딩이 없습니다.", severity: "warning" });
  if(script.scenes.some(scene=>scene.set||scene.routes?.length||scene.choices?.some(choice=>choice.when||choice.disable||choice.add))){
    const byId=new Map(script.scenes.map(scene=>[scene.id,scene]));
    const seen=new Set<string>(),blocked=new Set<string>();
    // 진입하는 씬의 set 을 플래그에 합친다 — 엔진의 진입 시점 적용과 같다.
    const enqueue=(id:string,flags:typeof script.flags)=>({id,flags:{...flags,...byId.get(id)?.set}});
    const queue=[enqueue(script.start,script.flags??{})];
    while(queue.length&&seen.size<10000){
      const state=queue.pop()!;
      const key=state.id+JSON.stringify(Object.entries(state.flags).sort(([a],[b])=>a.localeCompare(b)));
      if(seen.has(key))continue;seen.add(key);
      const scene=byId.get(state.id);if(!scene)continue;
      // input 줄은 그 줄을 지나야 뒤로 진행되므로, 무조건 input 플래그는 출구 시점에 항상 비어있지 않은 값으로 세팅돼 있다.
      // when 이 붙은 input 은 건너뛸 수 있다 — 쓰임·안 쓰임 두 경우를 모두 탐색해
      // "플래그가 세팅됐다"고 가정한 경로만 믿는 거짓 통과와 그 반대를 모두 피한다.
      const outFlags={...state.flags};
      // input 은 실행 시 항상 문자열을 쓴다 — 이미 선언된 플래그라도 덮어쓰므로 "?"로 둔다.
      for(const line of scene.lines)if(line.input&&line.when===undefined)outFlags[line.input.flag]="?";
      const maybes=[...new Set(scene.lines.flatMap(line=>line.input&&line.when!==undefined?[line.input.flag]:[]))];
      const variants=[outFlags];
      if(maybes.length<=4){
        for(const flag of maybes)for(const base of variants.slice())variants.push({...base,[flag]:"?"});
      }else for(const flag of maybes)outFlags[flag]="?"; // 조건 입력이 많으면 세팅된 쪽으로 본다
      if(scene.choices?.length){
        let deadCount=0;
        for(const flags of variants){
          for(const choice of scene.choices){const error=choiceEffectError(choice,flags);const key=scene.id+error;if(error&&!choice.disable&&!choice.cond&&lineAllowed(choice,flags)&&!blocked.has(key)){blocked.add(key);issues.push({sceneId:scene.id,message:`선택 결과 오류: ${error}`,severity:"error"});}}
          const available=scene.choices.filter(choice=>choiceAllowed(choice,flags));
          if(available.length)for(const choice of available)queue.push(enqueue(choice.next,applyChoiceFlags(flags,choice)));
          else deadCount++;
        }
        if(deadCount===variants.length&&!blocked.has(scene.id)){blocked.add(scene.id);issues.push({sceneId:scene.id,message:"도달 가능한 경로에서 선택지가 모두 닫힙니다. 조건이나 대체 선택지를 확인하세요.",severity:"error"});}
        else if(deadCount>0){const key=scene.id+"#partial-dead";if(!blocked.has(key)){blocked.add(key);issues.push({sceneId:scene.id,message:"일부 상태에서 선택지가 모두 닫힐 수 있습니다 — 조건부 입력이 건너뛰어지면 남는 선택지가 없습니다.",severity:"warning"});}}
      }else{
        // 엔진과 같이 처음으로 조건이 맞는 경로만 따라간다. 전부 실패하면 next 로 폴백한다.
        let deadCount=0;
        for(const flags of variants){
          const taken=(scene.routes??[]).find(route=>lineAllowed(route,flags));
          const follow=taken?.next??(scene.ending?undefined:scene.next);
          if(follow)queue.push(enqueue(follow,flags));
          else if(!scene.ending)deadCount++;
        }
        // 도달 상태 전부가 막히면 확정 데드엔드(실행 시 "갈 곳이 없다" 치명 오류), 일부만 막히면 조건부.
        if(deadCount===variants.length&&!blocked.has(scene.id)){blocked.add(scene.id);issues.push({sceneId:scene.id,message:"도달 가능한 상태에서 갈 곳이 없습니다 — 모든 경로가 닫히고 다음 씬·엔딩도 없습니다.",severity:"error"});}
        else if(deadCount>0){const key=scene.id+"#partial-dead";if(!blocked.has(key)){blocked.add(key);issues.push({sceneId:scene.id,message:"일부 상태에서 갈 곳이 없을 수 있습니다 — 조건부 입력이 건너뛰어지면 닫히는 경로만 남습니다.",severity:"warning"});}}
      }
    }
    if(queue.length)issues.push({sceneId:script.start,message:"분기 상태가 10,000개를 넘어 조건 경로 검사가 일부만 수행되었습니다.",severity:"warning"});
  }
  return issues;
}
