import type { Scene, StoryFlags, VnScript } from "@vnmaker/content";

export type Phase = "title" | "scene" | "choice" | "ending";

export interface HistoryEntry {
  readonly speaker: string | null;
  readonly text: string;
  /** Source label captured when read; absent in older saves. */
  readonly sceneId?: string;
  readonly chapter?: string;
}

export interface VnState {
  readonly phase: Phase;
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly affection: number;
  readonly flags: StoryFlags;
  readonly history: readonly HistoryEntry[];
  readonly endingTitle: string | null;
  /** 존재하지 않는 씬을 가리켰을 때 예외 대신 여기에 남긴다. */
  readonly error: string | null;
  /** 씬이 바뀔 때마다 증가한다. 전환 애니메이션 트리거. */
  readonly sceneEpoch: number;
}

export type VnAction =
  | { readonly type: "start" }
  | { readonly type: "advance" }
  | { readonly type: "choose"; readonly index: number }
  | { readonly type: "skipScene" }
  | { readonly type: "restore"; readonly sceneId: string; readonly lineIndex: number; readonly affection: number; readonly flags?: StoryFlags; readonly phase?: Phase; readonly history?: readonly HistoryEntry[] }
  | { readonly type: "backToTitle" };

export interface SaveData {
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly affection: number;
  readonly savedAt: number;
  readonly script?: VnScript;
  readonly flags?: StoryFlags;
  readonly phase?: Phase;
  readonly history?: readonly HistoryEntry[];
}

export function initialState(script: VnScript): VnState {
  return {
    phase: "title",
    sceneId: script.start,
    lineIndex: 0,
    affection: 0,
    flags: { ...script.flags },
    history: [],
    endingTitle: null,
    error: null,
    sceneEpoch: 0,
  };
}

export function findScene(script: VnScript, id: string): Scene | null {
  return script.scenes.find((s) => s.id === id) ?? null;
}
