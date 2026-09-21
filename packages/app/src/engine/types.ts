import type { Line, Scene, StoryFlags, VnScript } from "@vnmaker/content";

export type Phase = "title" | "scene" | "choice" | "ending";

export interface HistoryEntry {
  readonly speaker: string | null;
  readonly text: string;
  /** Source label captured when read; absent in older saves. */
  readonly sceneId?: string;
  readonly chapter?: string;
}

/** 롤백에 필요한 과거 시각 상태의 스냅샷. 세이브에는 포함하지 않는다(세션 내 이동). */
export interface PastSnapshot {
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly affection: number;
  readonly flags: StoryFlags;
  readonly phase: Phase;
  readonly endingTitle: string | null;
  readonly history: readonly HistoryEntry[];
}

export interface VnState {
  readonly phase: Phase;
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly affection: number;
  readonly flags: StoryFlags;
  readonly history: readonly HistoryEntry[];
  /** back 액션으로 되돌아갈 과거 상태 스택(최대 300개). */
  readonly past: readonly PastSnapshot[];
  readonly endingTitle: string | null;
  /** 존재하지 않는 씬을 가리켰을 때 예외 대신 여기에 남긴다. */
  readonly error: string | null;
  /** 씬이 바뀔 때마다 증가한다. 전환 애니메이션 트리거. */
  readonly sceneEpoch: number;
}

/** 세이브에 담는 압축 롤백 기록 — 불러온 뒤에도 「이전」이 동작하게 한다. history 는 길이만 남기고 앞부분을 잘라 복원한다. */
export interface RollbackEntry {
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly affection: number;
  readonly flags: StoryFlags;
  readonly phase: Phase;
  readonly historyLength: number;
}
/** 세이브에 남기는 롤백 기록 개수 상한. */
export const ROLLBACK_LIMIT = 30;

/** 읽은 대사를 기억하는 키. 줄 id 가 있으면 순서를 바꿔도 유지된다. */
export function readKey(sceneId: string, index: number, line?: Pick<Line, "id"> | undefined): string {
  return `${sceneId}#${line?.id ?? index}`;
}

export type VnAction =
  | { readonly type: "start" }
  | { readonly type: "advance" }
  | { readonly type: "back" }
  | { readonly type: "choose"; readonly index: number }
  /** 현재 씬 안에서 이미 읽은 대사를 건너뛴다. readKeys 가 없으면 읽지 않은 대사도 건너뛴다(설정 「모두 스킵」). */
  | { readonly type: "skipToChoice"; readonly readKeys?: ReadonlySet<string> | undefined }
  | { readonly type: "restore"; readonly sceneId: string; readonly lineIndex: number; readonly affection: number; readonly flags?: StoryFlags; readonly phase?: Phase; readonly history?: readonly HistoryEntry[]; readonly rollback?: readonly RollbackEntry[] | undefined }
  /** input 줄에 독자가 넣은 값을 플래그에 저장하고 다음 줄로 간다. */
  | { readonly type: "input"; readonly flag: string; readonly value: string }
  | { readonly type: "backToTitle" };

export interface SaveData {
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly affection: number;
  readonly savedAt: number;
  readonly script?: VnScript;
  /** 원고 보관함(vnmaker:manuscripts)의 지문. script 를 내장하지 않은 저장이 원고를 가리키는 방법이다. */
  readonly scriptKey?: string;
  readonly flags?: StoryFlags;
  readonly phase?: Phase;
  readonly history?: readonly HistoryEntry[];
  readonly rollback?: readonly RollbackEntry[];
}

export function initialState(script: VnScript): VnState {
  return {
    phase: "title",
    sceneId: script.start,
    lineIndex: 0,
    affection: 0,
    flags: { ...script.flags },
    history: [],
    past: [],
    endingTitle: null,
    error: null,
    sceneEpoch: 0,
  };
}

export function findScene(script: VnScript, id: string): Scene | null {
  return script.scenes.find((s) => s.id === id) ?? null;
}
