/**
 * vnmaker 시나리오 스키마 — 이 파일이 전체 파이프라인의 계약이다.
 * 시나리오 작성 노드, 플레이어 엔진, e2e 테스트가 모두 이 타입을 기준으로 동작한다.
 * 스키마를 바꾸면 세 곳이 같이 깨진다. 필드 추가는 optional 로만 한다.
 */

/** 등장인물 슬롯. 화면에 동시에 최대 두 명. */
export type SpriteSlot = "left" | "center" | "right";

/** 표정. 스프라이트 파일명 규칙: sprite/<characterId>-<expression>.png */
export type Expression = "neutral" | "smile" | "sad" | "surprised";

export type CharacterId = "seorin" | "dohyun" | "mirae";

/** 화면 전환 효과. */
export type Transition = "none" | "fade" | "dissolve" | "flash" | "fadeToBlack";

/** 배우 배치 지시. sprite 가 null 이면 슬롯을 비운다. */
export interface SpriteDirection {
  readonly slot: SpriteSlot;
  readonly character: CharacterId | null;
  readonly expression?: Expression;
}

/** 대사 한 줄. speaker 가 null 이면 내레이션. */
export interface Line {
  readonly speaker: CharacterId | "me" | null;
  readonly text: string;
  /** 이 줄에서 표정만 바꿀 때 사용. */
  readonly expression?: Expression;
  /** 이 줄과 함께 재생할 효과음 id. */
  readonly sfx?: string;
  /** 이 줄에서 화면을 흔든다. */
  readonly shake?: boolean;
}

export interface Choice {
  readonly text: string;
  /** 이동할 scene id. */
  readonly next: string;
  /** 이 선택으로 올라가는 호감도 플래그. */
  readonly affection?: number;
}

export interface Scene {
  readonly id: string;
  /** 화면 좌상단에 표시할 장 제목. 없으면 표시하지 않는다. */
  readonly chapter?: string;
  readonly background: string;
  readonly bgm?: string;
  readonly transition?: Transition;
  readonly sprites?: readonly SpriteDirection[];
  readonly lines: readonly Line[];
  /** 선택지가 있으면 next 는 무시된다. */
  readonly choices?: readonly Choice[];
  readonly next?: string;
  /** 엔딩 씬이면 엔딩 제목. 이 값이 있으면 엔딩 화면으로 넘어간다. */
  readonly ending?: string;
}

export interface Character {
  readonly id: CharacterId;
  readonly name: string;
  readonly color: string;
  readonly bio: string;
}

export interface VnScript {
  readonly title: string;
  readonly subtitle: string;
  readonly start: string;
  readonly characters: readonly Character[];
  readonly scenes: readonly Scene[];
}
