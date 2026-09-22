import type { RollbackEntry, SaveData } from "../engine/types.js";
import { ROLLBACK_LIMIT } from "../engine/types.js";
import { parseScript, validBackgroundUrl, type StoryFlags, type VnScript } from "@vnmaker/content";
import { manuscriptFingerprint } from "./manuscriptKey.js";

const SAVE_KEY = "vnmaker:save";
const SLOTS_KEY = "vnmaker:slots";
const AUTO_KEY = "vnmaker:auto";
const QUICK_KEY = "vnmaker:quick";
const SETTINGS_KEY = "vnmaker:settings";
/** 세이브가 가리키는 원고 보관함 — 지문 → 원고. 스냅숏마다 원고를 내장하지 않기 위한 공용 저장소다. */
const MANUSCRIPTS_KEY = "vnmaker:manuscripts";
const READ_KEY = "vnmaker:read";

export const SLOT_COUNT = 6;
/** 읽은 대사 기억 상한. 넘으면 오래된 씬부터 잊는다. */
export const READ_LIMIT = 50_000;
/** 자동 저장이 저장 공간 부족으로 실패하면 기록을 이만큼만 남겨 다시 시도한다. */
const TRIMMED_HISTORY = 40;

export interface SlotSave extends SaveData {
  readonly preview: string;
  readonly chapter: string | null;
  readonly thumbnail: string | null;
}

export interface Settings {
  readonly bgmVolume: number;
  readonly sfxVolume: number;
  readonly voiceVolume?: number;
  /** 한 글자당 밀리초. 낮을수록 빠르다. */
  readonly textSpeed: number;
  /** 오토 진행 시 글자당 대기 밀리초. 낮을수록 빨리 넘어간다. */
  readonly autoSpeed?: number;
  /** 모든 소리를 끈다. 음량 값은 유지된다. */
  readonly muted?: boolean;
  /** true 면 읽지 않은 대사도 스킵한다. 기본은 읽은 대사만 건너뛴다. */
  readonly skipUnread?: boolean;
}

export const defaultSettings: Settings = { bgmVolume: 0.55, sfxVolume: 0.7, voiceVolume: 0.8, textSpeed: 28, autoSpeed: 45, muted: false, skipUnread: false };

// ---- 읽기 캐시 -------------------------------------------------------------
// 타이프라이터가 프레임마다 App 을 다시 그리는 동안 저장 창이 열려 있으면 슬롯 전체를 매 프레임 파싱하게 된다.
// 저장된 원문 문자열이 같으면 이전 파싱 결과를 그대로 돌려준다 — 다른 탭이 바꾼 값도 원문이 달라지므로 놓치지 않는다.
const cache = new Map<string, { raw: string | null; value: unknown }>();
function readRaw(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function cached<T>(key: string, compute: (raw: string | null) => T): T {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  const value = compute(raw);
  cache.set(key, { raw, value });
  return value;
}
/** 저장소를 밖에서 통째로 바꿨을 때(테스트의 메모리 저장소 교체 등) 캐시를 버린다. */
export function invalidateStorageCache(): void { cache.clear(); parsedManuscripts.clear(); }

function parseJson(raw: string | null): unknown {
  try { return raw === null ? null : JSON.parse(raw) as unknown; } catch {
    // 손상된 값은 조용히 버린다. 앱은 타이틀에서 부팅한다.
    return null;
  }
}
function readJson(key: string): unknown { return parseJson(readRaw(key)); }
function write(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const scopedKey = (key: string, scope = "") => scope ? `${key}:${scope}` : key;
const legacyKey = (preview: boolean, namespace: string) => scopedKey(preview ? `${SAVE_KEY}:preview` : SAVE_KEY, namespace);
/** 슬롯 scope("네임스페이스:preview")를 옛 단일 키의 (preview, namespace) 쌍으로 되돌린다. */
function legacyKeyForScope(scope: string): string {
  const parts = scope.split(":").filter(Boolean);
  const preview = parts.includes("preview");
  return legacyKey(preview, parts.filter(part => part !== "preview").join(":"));
}
export function saveScopeOf(preview: boolean, namespace: string): string { return [namespace, preview ? "preview" : ""].filter(Boolean).join(":"); }

// ---- 원고 보관함 -----------------------------------------------------------
const parsedManuscripts = new Map<string, VnScript>();
function manuscriptStore(scope: string): Record<string, unknown> {
  return cached(scopedKey(MANUSCRIPTS_KEY, scope), raw => {
    const value = parseJson(raw);
    return isRecord(value) && !Array.isArray(value) ? value : {};
  });
}
/** 지문으로 보관된 원고를 찾는다. 같은 지문은 같은 원고이므로 파싱 결과를 영구 캐시한다. */
export function manuscriptFor(key: string, scope = ""): VnScript | null {
  const store = manuscriptStore(scope);
  if (!Object.hasOwn(store, key)) return null;
  const cacheKey = `${scope} ${key}`;
  const hit = parsedManuscripts.get(cacheKey);
  if (hit) return hit;
  try {
    const script = parseScript(store[key]);
    parsedManuscripts.set(cacheKey, script);
    return script;
  } catch { return null; }
}
/** 세이브 하나가 가리키는 원고 지문들. 내장 원고(구형식)는 지문이 없다. */
function referencedKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referencedKeys);
  return isRecord(value) && typeof value["scriptKey"] === "string" ? [value["scriptKey"]] : [];
}
/** 새 원고가 들어온 scope — 세이브를 쓴 뒤 한 번 정리한다. */
const pendingPrune = new Set<string>();
/**
 * 원고를 보관함에 넣고 지문을 돌려준다. 이미 있으면 그대로 쓴다.
 * 저장에 실패하면 null — 호출자가 원고를 내장한다.
 */
export function storeManuscript(script: VnScript, scope = ""): string | null {
  const key = manuscriptFingerprint(script);
  const store = manuscriptStore(scope);
  if (Object.hasOwn(store, key)) return key;
  if (!write(scopedKey(MANUSCRIPTS_KEY, scope), JSON.stringify({ ...store, [key]: script }))) return null;
  parsedManuscripts.set(`${scope} ${key}`, script);
  pendingPrune.add(scope);
  return key;
}
/** 어떤 세이브도 가리키지 않는 원고를 보관함에서 지운다. 새 원고를 넣은 직후, 세이브 쓰기가 끝난 뒤에만 실행한다. */
function pruneManuscripts(scope: string): void {
  if (!pendingPrune.delete(scope)) return;
  const store = manuscriptStore(scope);
  const referenced = new Set<string>([readJson(legacyKeyForScope(scope)), readJson(scopedKey(AUTO_KEY, scope)), readJson(scopedKey(QUICK_KEY, scope)), readJson(scopedKey(SLOTS_KEY, scope))].flatMap(referencedKeys));
  const stale = Object.keys(store).filter(key => !referenced.has(key));
  if (!stale.length) return;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(store)) if (referenced.has(key)) next[key] = value;
  for (const key of stale) parsedManuscripts.delete(`${scope} ${key}`);
  write(scopedKey(MANUSCRIPTS_KEY, scope), JSON.stringify(next));
}
/** 저장 직전에 원고를 보관함으로 옮기고 지문만 남긴다. 보관함 쓰기에 실패하면 구형식대로 내장한다. */
function serializeSave(data: SaveData, scope: string): string {
  if (!data.script) return JSON.stringify(data);
  const key = storeManuscript(data.script, scope);
  if (!key) return JSON.stringify(data);
  const { script: _embedded, ...rest } = data;
  return JSON.stringify({ ...rest, scriptKey: key });
}
/** 세이브 한 건을 쓰고, 새 원고가 들어왔다면 보관함을 정리한다. */
function writeSaveRecord(key: string, data: SaveData, scope: string): boolean {
  const ok = write(key, serializeSave(data, scope));
  pruneManuscripts(scope);
  return ok;
}

// ---- 세이브 검증 -----------------------------------------------------------
const FLAG_NAME = /^[a-z][a-z0-9_-]{0,63}$/i;
/** 저장·프리뷰 등 밖에서 온 플래그 맵을 허용 타입으로 좁힌다. */
export function coerceFlags(value: unknown): StoryFlags | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 200).filter(([key, flag]) => FLAG_NAME.test(key) && !["constructor", "prototype"].includes(key) && (typeof flag === "string" || typeof flag === "boolean" || typeof flag === "number" && Number.isFinite(flag)))) as StoryFlags;
}
/**
 * 복원한 선택 기억의 타입을 원고의 초기값과 맞춘다. 숫자 변수에 문자열이 들어 있으면 `add` 선택지가
 * 활성 버튼으로 그려지고도 눌러도 반응하지 않는다(죽은 버튼). 타입이 다른 값은 원고의 초기값으로 되돌린다.
 * 초기값에 없는 이름은 선택지가 새로 만든 변수이므로 그대로 둔다.
 */
export function reconcileFlags(flags: StoryFlags | undefined, defaults: StoryFlags | undefined): StoryFlags | undefined {
  if (!flags || !defaults) return flags;
  const next: Record<string, string | number | boolean> = { ...flags };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (Object.hasOwn(next, key) && typeof next[key] !== typeof fallback) next[key] = fallback;
  }
  return next;
}
function coerceRollback(value: unknown): RollbackEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: RollbackEntry[] = [];
  for (const item of value.slice(-ROLLBACK_LIMIT)) {
    if (!isRecord(item)) continue;
    const { sceneId, lineIndex, affection, historyLength, phase } = item;
    if (typeof sceneId !== "string" || sceneId.length === 0 || sceneId.length > 20_000) continue;
    if (typeof lineIndex !== "number" || !Number.isFinite(lineIndex) || lineIndex < 0) continue;
    entries.push({ sceneId, lineIndex: Math.floor(lineIndex), affection: typeof affection === "number" && Number.isFinite(affection) ? affection : 0, flags: coerceFlags(item["flags"]) ?? {}, phase: phase === "choice" ? "choice" : "scene", historyLength: typeof historyLength === "number" && Number.isFinite(historyLength) && historyLength >= 0 ? Math.floor(historyLength) : 0 });
  }
  return entries;
}

export function loadSave(preview = false, namespace = ""): SaveData | null {
  return cached(legacyKey(preview, namespace), raw => coerceSave(parseJson(raw), saveScopeOf(preview, namespace)));
}

function coerceSave(value: unknown, scope = ""): SaveData | null {
  if (!isRecord(value)) return null;
  const { sceneId, lineIndex, affection, savedAt } = value;
  if (typeof sceneId !== "string" || sceneId.length === 0 || sceneId.length > 20_000) return null;
  if (typeof lineIndex !== "number" || !Number.isFinite(lineIndex) || lineIndex < 0) return null;
  let savedScript: VnScript | undefined;
  let scriptKey: string | undefined;
  if (value["script"] !== undefined) {
    try { savedScript = parseScript(value["script"]); } catch { return null; }
  } else if (typeof value["scriptKey"] === "string" && value["scriptKey"].length <= 64) {
    scriptKey = value["scriptKey"];
    savedScript = manuscriptFor(scriptKey, scope) ?? undefined;
  }
  const flags = reconcileFlags(coerceFlags(value["flags"]), savedScript?.flags);
  const rollback = coerceRollback(value["rollback"]);
  return {
    sceneId,
    lineIndex: Math.floor(lineIndex),
    affection: typeof affection === "number" && Number.isFinite(affection) ? affection : 0,
    savedAt: typeof savedAt === "number" ? savedAt : 0,
    ...(savedScript ? { script: savedScript } : {}),
    ...(scriptKey ? { scriptKey } : {}),
    ...(flags ? { flags } : {}),
    ...(["scene", "choice", "ending"].includes(String(value["phase"])) ? { phase: value["phase"] as "scene" | "choice" | "ending" } : {}),
    ...(Array.isArray(value["history"]) ? { history: value["history"].filter((entry): entry is { speaker: string | null; text: string; sceneId?: unknown; chapter?: unknown } => isRecord(entry) && (entry["speaker"] === null || typeof entry["speaker"] === "string" && entry["speaker"].length <= 20_000) && typeof entry["text"] === "string" && entry["text"].length <= 20_000).slice(-2000).map(entry => ({ speaker: entry.speaker, text: entry.text, ...(typeof entry.sceneId === "string" && entry.sceneId.length <= 20000 ? { sceneId: entry.sceneId } : {}), ...(typeof entry.chapter === "string" && entry.chapter.length <= 20000 ? { chapter: entry.chapter } : {}) })) } : {}),
    ...(rollback ? { rollback } : {}),
  };
}

export function writeSave(data: SaveData, preview = false, namespace = ""): boolean {
  return writeSaveRecord(legacyKey(preview, namespace), data, saveScopeOf(preview, namespace));
}

function coerceSlot(value: unknown, scope: string): SlotSave | null {
  const base = coerceSave(value, scope);
  if (!base || !isRecord(value)) return null;
  return { ...base, preview: typeof value.preview === "string" ? value.preview : "", chapter: typeof value.chapter === "string" ? value.chapter : null, thumbnail: validBackgroundUrl(value.thumbnail) ? value.thumbnail : null };
}

export function listSlots(scope = ""): readonly (SlotSave | null)[] {
  return cached(scopedKey(SLOTS_KEY, scope), raw => {
    const value = parseJson(raw);
    return Array.from({ length: SLOT_COUNT }, (_, index) => Array.isArray(value) ? coerceSlot(value[index], scope) : null);
  });
}

export function readSlot(index: number, scope = ""): SlotSave | null { return Number.isInteger(index) && index >= 0 && index < SLOT_COUNT ? listSlots(scope)[index] ?? null : null; }
export function writeSlot(index: number, data: SlotSave, scope = ""): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return false;
  // 원고는 보관함에 한 번만 두고, 슬롯 목록에는 지문만 남긴다. 다른 슬롯의 기존 내장 원고도 이번 기회에 지문으로 바꾼다.
  const raw = readJson(scopedKey(SLOTS_KEY, scope));
  const rows = Array.from({ length: SLOT_COUNT }, (_, i) => Array.isArray(raw) ? raw[i] ?? null : null);
  const serialized = rows.map((row, i) => {
    if (i === index) return serializeSave(data, scope);
    const slot = coerceSlot(row, scope);
    return slot ? serializeSave(slot, scope) : "null";
  });
  const ok = write(scopedKey(SLOTS_KEY, scope), `[${serialized.join(",")}]`);
  pruneManuscripts(scope);
  return ok;
}
export function readAutoSlot(scope = ""): SlotSave | null { return cached(scopedKey(AUTO_KEY, scope), raw => coerceSlot(parseJson(raw), scope)); }
/**
 * 자동 저장. 저장 공간이 부족하면 대사 기록·롤백을 줄인 스냅숏으로 한 번 더 시도한다 —
 * 마지막 성공 저장이 남아 있어야 「이어서 읽기」가 살아 있다.
 */
export function writeAutoSlot(data: SlotSave, scope = ""): boolean {
  if (writeSaveRecord(scopedKey(AUTO_KEY, scope), data, scope)) return true;
  const trimmed: SlotSave = { ...data, ...(data.history ? { history: data.history.slice(-TRIMMED_HISTORY) } : {}), ...(data.rollback ? { rollback: data.rollback.slice(-5) } : {}) };
  return writeSaveRecord(scopedKey(AUTO_KEY, scope), trimmed, scope);
}
export function readQuickSlot(scope = ""): SlotSave | null { return cached(scopedKey(QUICK_KEY, scope), raw => coerceSlot(parseJson(raw), scope)); }
export function writeQuickSlot(data: SlotSave, scope = ""): boolean { return writeSaveRecord(scopedKey(QUICK_KEY, scope), data, scope); }
export function latestSave(preview = false, namespace = ""): SaveData | null {
  const scope = saveScopeOf(preview, namespace);
  return [loadSave(preview, namespace), readAutoSlot(scope), readQuickSlot(scope), ...listSlots(scope)].filter((save): save is SaveData => save !== null).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}
export function formatSlotDate(savedAt: number): string { return new Date(savedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

// ---- 설정 -----------------------------------------------------------------
/**
 * 설정을 읽는다. scope(독립 배포판의 네임스페이스)에 저장된 값이 없으면 공용 설정을 이어받는다 —
 * 같은 오리진의 다른 게임과 값을 공유하지 않으면서도 첫 실행에 낯선 기본값으로 시작하지 않는다.
 */
export function loadSettings(scope = ""): Settings {
  const value = readJson(scopedKey(SETTINGS_KEY, scope)) ?? (scope ? readJson(SETTINGS_KEY) : null);
  if (!isRecord(value)) return defaultSettings;
  const num = (key: keyof Settings, fallback: number, min: number, max: number): number => {
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, raw));
  };
  return {
    bgmVolume: num("bgmVolume", defaultSettings.bgmVolume, 0, 1),
    sfxVolume: num("sfxVolume", defaultSettings.sfxVolume, 0, 1),
    voiceVolume: num("voiceVolume", defaultSettings.voiceVolume ?? 0.8, 0, 1),
    textSpeed: num("textSpeed", defaultSettings.textSpeed, 5, 90),
    autoSpeed: num("autoSpeed", defaultSettings.autoSpeed ?? 45, 10, 150),
    muted: value["muted"] === true,
    skipUnread: value["skipUnread"] === true,
  };
}

export function writeSettings(settings: Settings, scope = ""): void {
  write(scopedKey(SETTINGS_KEY, scope), JSON.stringify(settings));
}

// ---- 읽은 대사 --------------------------------------------------------------
/** 읽은 대사 키 집합(`씬#줄`). 「읽은 텍스트만 스킵」의 근거다. */
export function readLineKeys(scope = ""): Set<string> {
  return cached(scopedKey(READ_KEY, scope), raw => {
    const value = parseJson(raw);
    const keys = new Set<string>();
    if (!isRecord(value) || Array.isArray(value)) return keys;
    for (const [sceneId, lines] of Object.entries(value)) {
      if (!Array.isArray(lines)) continue;
      for (const line of lines) if (typeof line === "string" || typeof line === "number") keys.add(`${sceneId}#${line}`);
    }
    return keys;
  });
}
/** 읽은 대사 키를 합쳐 저장한다. 상한을 넘으면 오래 전 씬부터 잊는다. 저장 실패는 false. */
export function rememberRead(keys: Iterable<string>, scope = ""): boolean {
  const value = readJson(scopedKey(READ_KEY, scope));
  // null-prototype — "constructor"·"__proto__" 같은 씬 id 도 상속 멤버와 충돌하지 않는다.
  const table: Record<string, string[]> = Object.create(null);
  let total = 0;
  if (isRecord(value) && !Array.isArray(value)) for (const [sceneId, lines] of Object.entries(value)) {
    if (!Array.isArray(lines)) continue;
    const kept = lines.filter((line): line is string | number => typeof line === "string" || typeof line === "number").map(String);
    if (kept.length) { table[sceneId] = kept; total += kept.length; }
  }
  let added = false;
  for (const key of keys) {
    const at = key.indexOf("#");
    if (at <= 0) continue;
    const sceneId = key.slice(0, at), line = key.slice(at + 1);
    // 프로토타입 멤버("constructor" 등)를 상속값으로 읽지 않게 own-key 만 본다.
    const lines = Object.hasOwn(table, sceneId) ? table[sceneId]! : (table[sceneId] = []);
    if (lines.includes(line)) continue;
    lines.push(line); total += 1; added = true;
  }
  if (!added) return true;
  for (const sceneId of Object.keys(table)) {
    if (total <= READ_LIMIT) break;
    total -= table[sceneId]!.length;
    delete table[sceneId];
  }
  return write(scopedKey(READ_KEY, scope), JSON.stringify(table));
}

// ---- 갤러리 -----------------------------------------------------------------
const GALLERY_KEY = "vnmaker:gallery";

export interface GalleryUnlocks {
  readonly cgs: readonly string[];
  readonly endings: readonly string[];
}

export const EMPTY_GALLERY: GalleryUnlocks = { cgs: [], endings: [] };

export function readGallery(scope = ""): GalleryUnlocks {
  const value = readJson(scopedKey(GALLERY_KEY, scope));
  if (!isRecord(value)) return EMPTY_GALLERY;
  const cgs = Array.isArray(value["cgs"]) ? value["cgs"].filter((v): v is string => validBackgroundUrl(v)).slice(0, 500) : [];
  const endings = Array.isArray(value["endings"]) ? value["endings"].filter((v): v is string => typeof v === "string" && v.length <= 20_000).slice(0, 100) : [];
  return { cgs, endings };
}

function writeGallery(gallery: GalleryUnlocks, scope: string): GalleryUnlocks {
  write(scopedKey(GALLERY_KEY, scope), JSON.stringify(gallery));
  return gallery;
}

/** 본 CG를 해금 목록에 추가한다. 이미 있으면 기존 목록을 그대로 돌려준다. */
export function unlockGalleryCg(url: string, scope = ""): GalleryUnlocks {
  const current = readGallery(scope);
  if (!validBackgroundUrl(url) || current.cgs.includes(url)) return current;
  return writeGallery({ ...current, cgs: [...current.cgs, url] }, scope);
}

export function unlockGalleryEnding(title: string, scope = ""): GalleryUnlocks {
  const current = readGallery(scope);
  if (typeof title !== "string" || title === "" || title.length > 20_000 || current.endings.includes(title)) return current;
  return writeGallery({ ...current, endings: [...current.endings, title] }, scope);
}
