import { applyChoiceFlags, choiceAllowed, lineAllowed } from "../../content/src/index.js";
import type { Scene, StoryFlags, VnScript } from "../../content/src/index.js";
import { DEFAULT_READING_SPEED } from "./production-limits.js";
import { pathRange } from "./production-graph.js";

export const countCharacters = (text: string): number => Array.from(text.replace(/\s/gu, "")).length;
export const sceneCharacters = (scene: Pick<Scene, "lines">): number =>
  scene.lines.reduce((sum, line) => sum + countCharacters(line.text), 0);

export interface DurationEstimate {
  readonly minMinutes: number | null;
  readonly maxMinutes: number | null;
  readonly totalCharacters: number;
  readonly hasCycle: boolean;
  readonly incomplete: boolean;
  readonly endingCount: number;
  readonly reachableScenes: number;
}

export function estimateScriptDuration(script: VnScript, charsPerMinute = DEFAULT_READING_SPEED): DurationEstimate {
  if (!Number.isFinite(charsPerMinute) || charsPerMinute <= 0) throw new Error("읽기 속도는 양수여야 합니다.");
  const weights = new Map(script.scenes.map(scene => [scene.id, sceneCharacters(scene)]));
  const result = pathRange(script.scenes, script.start, weights);
  const totalCharacters = [...weights.values()].reduce((sum, value) => sum + value, 0);
  if (script.scenes.some(scene => scene.lines.some(line => line.when) || scene.choices?.some(choice => choice.when || choice.disable || choice.add)) && !result.hasCycle) {
    const memo = new Map<string, { min: number; max: number } | null>();
    const byId = new Map(script.scenes.map(scene => [scene.id, scene]));
    let states = 0;
    let incomplete = result.incomplete;
    const range = (id: string, flags: StoryFlags): { min: number; max: number } | null => {
      const key = id + JSON.stringify(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)));
      if (memo.has(key)) {
        const cached = memo.get(key);
        return cached === undefined ? null : cached;
      }
      if (++states > 10000) { incomplete = true; return null; }
      const scene = byId.get(id);
      if (scene === undefined) { incomplete = true; return null; }
      const own = scene.lines.filter(line => lineAllowed(line, flags)).reduce((sum, line) => sum + countCharacters(line.text), 0);
      const tails = scene.choices?.length
        ? scene.choices.filter(choice => choiceAllowed(choice, flags)).map(choice => range(choice.next, applyChoiceFlags(flags, choice)))
        : scene.ending ? [{ min: 0, max: 0 }] : scene.next ? [range(scene.next, flags)] : [];
      if (!tails.length || tails.some(tail => tail === null)) incomplete = true;
      const valid = tails.filter((tail): tail is { min: number; max: number } => tail !== null);
      const value = valid.length
        ? { min: own + Math.min(...valid.map(tail => tail.min)), max: own + Math.max(...valid.map(tail => tail.max)) }
        : null;
      memo.set(key, value);
      return value;
    };
    const conditional = range(script.start, script.flags ?? {});
    return {
      minMinutes: incomplete || !conditional ? null : conditional.min / charsPerMinute,
      maxMinutes: incomplete || !conditional ? null : conditional.max / charsPerMinute,
      totalCharacters, hasCycle: false, incomplete, endingCount: result.endingCount, reachableScenes: result.reachable.size,
    };
  }
  return {
    minMinutes: result.min === null ? null : result.min / charsPerMinute,
    maxMinutes: result.max === null ? null : result.max / charsPerMinute,
    totalCharacters,
    hasCycle: result.hasCycle,
    incomplete: result.incomplete || script.scenes.some(scene => result.reachable.has(scene.id) && (!scene.lines.length || scene.lines.some(line => !line.text.trim()))),
    endingCount: result.endingCount,
    reachableScenes: result.reachable.size,
  };
}

export function durationLabel(estimate: Pick<DurationEstimate, "minMinutes" | "maxMinutes">): string {
  if (estimate.minMinutes === null) return "경로 미완성";
  const min = Math.round(estimate.minMinutes * 10) / 10;
  if (estimate.maxMinutes === null) return `${min}분 이상`;
  const max = Math.round(estimate.maxMinutes * 10) / 10;
  return min === max ? `${min}분` : `${min}–${max}분`;
}
