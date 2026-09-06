import type { SaveData } from "../engine/types.js";
import { parseScript, validBackgroundUrl } from "@vnmaker/content";

const SAVE_KEY = "vnmaker:save";
const SLOTS_KEY = "vnmaker:slots";
const AUTO_KEY = "vnmaker:auto";
const SETTINGS_KEY = "vnmaker:settings";

export const SLOT_COUNT = 6;

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
}

export const defaultSettings: Settings = { bgmVolume: 0.55, sfxVolume: 0.7, voiceVolume: 0.8, textSpeed: 28 };

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    // 손상된 값은 조용히 버린다. 앱은 타이틀에서 부팅한다.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const scopedKey = (key: string, scope = "") => scope ? `${key}:${scope}` : key;
export function loadSave(preview = false, namespace = ""): SaveData | null {
  const value = readJson(scopedKey(preview ? `${SAVE_KEY}:preview` : SAVE_KEY, namespace));
  return coerceSave(value);
}

function coerceSave(value: unknown): SaveData | null {
  if (!isRecord(value)) return null;
  const { sceneId, lineIndex, affection, savedAt } = value;
  if (typeof sceneId !== "string" || sceneId.length === 0) return null;
  if (typeof lineIndex !== "number" || !Number.isFinite(lineIndex) || lineIndex < 0) return null;
  let savedScript;
  if (value["script"] !== undefined) {
    try { savedScript = parseScript(value["script"]); } catch { return null; }
  }
  return {
    sceneId,
    lineIndex: Math.floor(lineIndex),
    affection: typeof affection === "number" && Number.isFinite(affection) ? affection : 0,
    savedAt: typeof savedAt === "number" ? savedAt : 0,
    ...(savedScript ? { script: savedScript } : {}),
    ...(isRecord(value["flags"]) ? {flags: Object.fromEntries(Object.entries(value["flags"]).filter(([key,flag])=>/^[a-z][a-z0-9_-]{0,63}$/i.test(key) && !["constructor","prototype"].includes(key) && (typeof flag === "string" || typeof flag === "boolean" || typeof flag === "number" && Number.isFinite(flag)))) as NonNullable<SaveData["flags"]>} : {}),
    ...(["scene","choice","ending"].includes(String(value["phase"])) ? {phase:value["phase"] as "scene"|"choice"|"ending"} : {}),
    ...(Array.isArray(value["history"]) ? {history:value["history"].filter((entry): entry is {speaker:string|null;text:string;sceneId?:unknown;chapter?:unknown}=>isRecord(entry) && (entry["speaker"]===null||typeof entry["speaker"]==="string") && typeof entry["text"]==="string").slice(-2000).map(entry=>({speaker:entry.speaker,text:entry.text,...(typeof entry.sceneId==="string" && entry.sceneId.length<=20000 ? {sceneId:entry.sceneId}:{}),...(typeof entry.chapter==="string" && entry.chapter.length<=20000 ? {chapter:entry.chapter}:{})}))} : {}),
  };
}

export function writeSave(data: SaveData, preview = false, namespace = ""): boolean {
  try {
    window.localStorage.setItem(scopedKey(preview ? `${SAVE_KEY}:preview` : SAVE_KEY, namespace), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function coerceSlot(value: unknown): SlotSave | null {
  const base = coerceSave(value);
  if (!base || !isRecord(value)) return null;
  return { ...base, preview: typeof value.preview === "string" ? value.preview : "", chapter: typeof value.chapter === "string" ? value.chapter : null, thumbnail: validBackgroundUrl(value.thumbnail) ? value.thumbnail : null };
}

export function listSlots(scope = ""): readonly (SlotSave | null)[] {
  const value = readJson(scopedKey(SLOTS_KEY,scope));
  return Array.from({ length: SLOT_COUNT }, (_, index) => Array.isArray(value) ? coerceSlot(value[index]) : null);
}

export function readSlot(index: number, scope = ""): SlotSave | null { return Number.isInteger(index) && index >= 0 && index < SLOT_COUNT ? listSlots(scope)[index] ?? null : null; }
export function writeSlot(index: number, data: SlotSave, scope = ""): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return false;
  try { window.localStorage.setItem(scopedKey(SLOTS_KEY,scope), JSON.stringify(listSlots(scope).map((slot,i)=>i===index?data:slot))); return true; } catch { return false; }
}
export function readAutoSlot(scope = ""): SlotSave | null { return coerceSlot(readJson(scopedKey(AUTO_KEY,scope))); }
export function writeAutoSlot(data: SlotSave, scope = ""): boolean { try { window.localStorage.setItem(scopedKey(AUTO_KEY,scope), JSON.stringify(data)); return true; } catch { return false; } }
export function latestSave(preview = false, namespace = ""): SaveData | null {
  const scope = [namespace,preview?"preview":""].filter(Boolean).join(":");
  return [loadSave(preview,namespace),readAutoSlot(scope),...listSlots(scope)].filter((save):save is SaveData=>save!==null).sort((a,b)=>b.savedAt-a.savedAt)[0] ?? null;
}
export function formatSlotDate(savedAt: number): string { return new Date(savedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

export function loadSettings(): Settings {
  const value = readJson(SETTINGS_KEY);
  if (!isRecord(value)) return defaultSettings;
  const num = (key: keyof Settings, fallback: number, min: number, max: number): number => {
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, raw));
  };
  return {
    bgmVolume: num("bgmVolume", defaultSettings.bgmVolume, 0, 1),
    sfxVolume: num("sfxVolume", defaultSettings.sfxVolume, 0, 1),
    voiceVolume: num("voiceVolume", defaultSettings.voiceVolume??0.8, 0, 1),
    textSpeed: num("textSpeed", defaultSettings.textSpeed, 5, 90),
  };
}

export function writeSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 무시 */
  }
}
