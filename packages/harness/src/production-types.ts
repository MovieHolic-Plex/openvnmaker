import type { Choice, Scene, VnScript } from "../../content/src/index.js";

export type ProductionTiming = {
  readonly now: () => number;
  readonly id: () => string;
};

export interface SceneBeat {
  readonly id: string;
  readonly chapter: string;
  readonly title: string;
  readonly summary: string;
  readonly artDirection: string;
  readonly targetMinutes: number;
  readonly background: string;
  readonly next?: string;
  readonly choices?: readonly Choice[];
  readonly ending?: string;
}

export interface StudioOutline {
  readonly title: string;
  readonly subtitle: string;
  readonly bible: string;
  readonly start: string;
  readonly scenes: readonly SceneBeat[];
}

export interface SceneDraft {
  readonly scene: Scene;
  readonly summary: string;
  readonly continuity: readonly string[];
  readonly model: string;
  readonly updatedAt: number;
}

export interface DraftJob {
  status: "pending" | "running" | "ready" | "short" | "error";
  draft?: SceneDraft;
  error?: string;
}

export interface ProductionPlan {
  version: 1;
  id: string;
  baseFingerprint: string;
  baseTitle: string;
  characters: VnScript["characters"];
  sourceArtDirection?: string;
  sourceAssets?: VnScript["assets"];
  brief: string;
  targetMinutes: number;
  charsPerMinute: number;
  outline: StudioOutline;
  jobs: Record<string, DraftJob>;
  createdAt: number;
}
