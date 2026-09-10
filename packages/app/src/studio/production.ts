import type { VnScript } from "@vnmaker/content";
import {
  assembleProduction,
  countCharacters,
  createPlan as createHarnessPlan,
  DEFAULT_READING_SPEED,
  durationLabel,
  estimateScriptDuration,
  makeDraftPrompt,
  makeOutlinePrompt,
  parseDraft as parseHarnessDraft,
  parseOutline,
  planDraftScript,
  restoreProduction as restoreHarnessProduction,
  sceneCharacters,
} from "@vnmaker/harness";
import type {
  DraftJob, DurationEstimate, ProductionPlan, SceneBeat, SceneDraft, StudioOutline,
} from "@vnmaker/harness";

export const PRODUCTION_KEY = "vnmaker.studio.production.v1";
export const PRODUCTION_BACKUP_KEY = "vnmaker.studio.production.previous.v1";
export {
  assembleProduction, countCharacters, DEFAULT_READING_SPEED, durationLabel,
  estimateScriptDuration, makeDraftPrompt, makeOutlinePrompt, parseOutline,
  planDraftScript, sceneCharacters,
};
export type { DraftJob, DurationEstimate, ProductionPlan, SceneBeat, SceneDraft };
export type ProductionOutline = StudioOutline;

const wallTiming = { now: () => Date.now(), id: () => crypto.randomUUID() };

export function createPlan(
  outline: ProductionOutline,
  base: VnScript,
  brief: string,
  targetMinutes: number,
  charsPerMinute = DEFAULT_READING_SPEED,
): ProductionPlan {
  return createHarnessPlan(outline, base, brief, targetMinutes, charsPerMinute, wallTiming);
}

export function parseDraft(
  text: string, plan: ProductionPlan, beat: SceneBeat, model: string, extend = false,
) {
  return parseHarnessDraft(text, plan, beat, model, extend, wallTiming);
}

export function restoreProduction(value: unknown): ProductionPlan {
  return restoreHarnessProduction(value, wallTiming);
}

export const scriptFingerprint = (script: VnScript): string => {
  let hash = 2166136261;
  for (const char of JSON.stringify(script)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
};
