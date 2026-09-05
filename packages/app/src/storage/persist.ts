import type { SaveData } from "../engine/types.js";
import { parseScript } from "@vnmaker/content";

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
  /** 한 글자당 밀리초. 낮을수록 빠르다. */
  readonly textSpeed: number;
}

export const defaultSettings: Settings = { bgmVolume: 0.55, sfxVolume: 0.7, textSpeed: 28 };

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

export function loadSave(preview = false): SaveData | null {
  const value = readJson(preview ? `${SAVE_KEY}:preview` : SAVE_KEY);
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
  };
}

export function writeSave(data: SaveData, preview = false): boolean {
  try {
    window.localStorage.setItem(preview ? `${SAVE_KEY}:preview` : SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function coerceSave(value: unknown): SaveData | null {
  if (!isRecord(value)) return null;
  const { sceneId, lineIndex, affection, savedAt } = value;
  if (typeof sceneId !== "string" || sceneId.length === 0 || typeof lineIndex !== "number" || !Number.isFinite(lineIndex) || lineIndex < 0) return null;
  return { sceneId, lineIndex: Math.floor(lineIndex), affection: typeof affection === "number" && Number.isFinite(affection) ? affection : 0, savedAt: typeof savedAt === "number" ? savedAt : 0 };
}

function coerceSlot(value: unknown): SlotSave | null {
  const base = coerceSave(value);
  if (!base || !isRecord(value)) return null;
  return { ...base, preview: typeof value.preview === "string" ? value.preview : "", chapter: typeof value.chapter === "string" ? value.chapter : null, thumbnail: typeof value.thumbnail === "string" ? value.thumbnail : null };
}

export function listSlots(): readonly (SlotSave | null)[] {
  const value = readJson(SLOTS_KEY);
  return Array.from({ length: SLOT_COUNT }, (_, index) => Array.isArray(value) ? coerceSlot(value[index]) : null);
}

export function readSlot(index: number): SlotSave | null { return Number.isInteger(index) && index >= 0 && index < SLOT_COUNT ? listSlots()[index] ?? null : null; }
export function writeSlot(index: number, data: SlotSave): void { if (Number.isInteger(index) && index >= 0 && index < SLOT_COUNT) { try { window.localStorage.setItem(SLOTS_KEY, JSON.stringify(listSlots().map((slot, i) => i === index ? data : slot))); } catch { /* ignore */ } } }
export function readAutoSlot(): SlotSave | null { return coerceSlot(readJson(AUTO_KEY)); }
export function writeAutoSlot(data: SlotSave): void { try { window.localStorage.setItem(AUTO_KEY, JSON.stringify(data)); } catch { /* ignore */ } }
export function migrateLegacySave(): SlotSave | null { return null; }
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
