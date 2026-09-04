import type { SaveData } from "../engine/types.js";

const SAVE_KEY = "vnmaker:save";
const SLOTS_KEY = "vnmaker:slots";
const AUTO_KEY = "vnmaker:auto";
const SETTINGS_KEY = "vnmaker:settings";

/** 수동 저장 슬롯 개수. 자동 슬롯(AUTO_KEY)은 별도이며 개수에 포함하지 않는다. */
export const SLOT_COUNT = 6;

export interface SlotSave extends SaveData {
  /** 이어하기 줄에 보여줄 마지막 대사 미리보기. */
  readonly preview: string;
  /** 저장 시점의 장 제목. 없으면 null. */
  readonly chapter: string | null;
  /** 저장 시점의 배경 id. 썸네일 대신 배경을 다시 보여줄 때 쓴다. */
  readonly thumbnail: string | null;
}

export interface Settings {
  readonly bgmVolume: number;
  readonly sfxVolume: number;
  /** 한 글자당 밀리초. 낮을수록 빠르다. */
  readonly textSpeed: number;
}

export const defaultSettings: Settings = { bgmVolume: 0.55, sfxVolume: 0.7, textSpeed: 28 };

function storage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null {
  try {
    const w = globalThis as unknown as { window?: { localStorage?: {
      getItem(k: string): string | null;
      setItem(k: string, v: string): void;
      removeItem(k: string): void;
    } } };
    return w.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    // 손상된 값은 조용히 버린다. 앱은 타이틀에서 부팅한다.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 공간이 막혀 있어도 게임은 계속된다 */
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceSave(value: unknown): SaveData | null {
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

function coerceSlot(value: unknown): SlotSave | null {
  const base = coerceSave(value);
  if (!base || !isRecord(value)) return null;
  return {
    ...base,
    preview: typeof value.preview === "string" ? value.preview : "",
    chapter: typeof value.chapter === "string" ? value.chapter : null,
    thumbnail: typeof value.thumbnail === "string" ? value.thumbnail : null,
  };
}

function validSlotIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < SLOT_COUNT;
}

/** 6개 수동 슬롯을 순서대로 읽는다. 비어 있는 슬롯은 null. */
export function listSlots(): readonly (SlotSave | null)[] {
  const value = readJson(SLOTS_KEY);
  const out: (SlotSave | null)[] = Array<SlotSave | null>(SLOT_COUNT).fill(null);
  if (!Array.isArray(value)) return out;
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    out[i] = coerceSlot(value[i]);
  }
  return out;
}

export function readSlot(index: number): SlotSave | null {
  if (!validSlotIndex(index)) return null;
  return listSlots()[index] ?? null;
}

export function writeSlot(index: number, data: SlotSave): void {
  if (!validSlotIndex(index)) return;
  const next = [...listSlots()];
  next[index] = data;
  writeJson(SLOTS_KEY, next);
}

/** 선택지·엔딩 도달 시 덮어쓰는 자동 슬롯. 이어하기 후보에도 포함된다. */
export function readAutoSlot(): SlotSave | null {
  return coerceSlot(readJson(AUTO_KEY));
}

export function writeAutoSlot(data: SlotSave): void {
  writeJson(AUTO_KEY, data);
}

/**
 * 옛날 단일 키(vnmaker:save)가 남아 있으면 1번 슬롯으로 이주한다.
 * 1번 슬롯이 이미 차 있으면 덮어쓰지 않고 null 을 돌려준다.
 */
export function migrateLegacySave(): SlotSave | null {
  const legacy = coerceSave(readJson(SAVE_KEY));
  if (!legacy) return null;
  if (readSlot(0) !== null) return null;
  const migrated: SlotSave = { ...legacy, preview: "", chapter: null, thumbnail: null };
  writeSlot(0, migrated);
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    /* 무시 */
  }
  return migrated;
}

/** 이어하기 줄에 붙는 짧은 날짜 표기. */
export function formatSlotDate(savedAt: number): string {
  try {
    return new Date(savedAt).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** 옛날 단일 슬롯 API. 이주 경로(migrateLegacySave) 이전의 호출과 호환용으로 남긴다. */
export function loadSave(): SaveData | null {
  return coerceSave(readJson(SAVE_KEY));
}

export function writeSave(data: SaveData): void {
  writeJson(SAVE_KEY, data);
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
  writeJson(SETTINGS_KEY, settings);
}
