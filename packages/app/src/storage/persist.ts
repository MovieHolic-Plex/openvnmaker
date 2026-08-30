import type { SaveData } from "../engine/types.js";

const SAVE_KEY = "vnmaker:save";
const SETTINGS_KEY = "vnmaker:settings";

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

export function loadSave(): SaveData | null {
  const value = readJson(SAVE_KEY);
  if (!isRecord(value)) return null;
  const { sceneId, lineIndex, affection, savedAt } = value;
  if (typeof sceneId !== "string" || sceneId.length === 0) return null;
  if (typeof lineIndex !== "number" || !Number.isFinite(lineIndex) || lineIndex < 0) return null;
  return {
    sceneId,
    lineIndex: Math.floor(lineIndex),
    affection: typeof affection === "number" && Number.isFinite(affection) ? affection : 0,
    savedAt: typeof savedAt === "number" ? savedAt : 0,
  };
}

export function writeSave(data: SaveData): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* 저장 공간이 막혀 있어도 게임은 계속된다 */
  }
}

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
