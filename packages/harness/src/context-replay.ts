import { canonicalJson } from "./canonical.js";
import type { ContextSource } from "./context.js";
import type { ReadSet } from "./context-contracts.js";
import { assertNever } from "./primitives.js";
import { parseContextRecipe } from "./context-replay-recipes.js";
import { replayQueryDependency } from "./context-replay-queries.js";
import {
  replayCollectionDependency,
  replayEntityDependency,
} from "./context-replay-values.js";

export type ContextDependencyReplay =
  | {
      readonly kind: "unchanged";
      readonly recorded: ReadSet[number];
      readonly current: ReadSet[number];
    }
  | {
      readonly kind: "changed";
      readonly recorded: ReadSet[number];
      readonly current: ReadSet[number];
    }
  | {
      readonly kind: "missing";
      readonly recorded: ReadSet[number];
      readonly reason: string;
    }
  | {
      readonly kind: "unsupported";
      readonly recorded: ReadSet[number];
      readonly reason: string;
    }
  | {
      readonly kind: "blocked";
      readonly recorded: ReadSet[number];
      readonly reason: string;
    };

export type ContextDependencyResolution =
  | { readonly kind: "current"; readonly current: ReadSet[number] }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string };

type EvaluatedDependency = {
  readonly outcome: ContextDependencyReplay;
  readonly branch: boolean;
  readonly bindsStart: boolean;
};

/** Replay one captured input frame; preserve order, duplicates and original records. */
export async function replayContextDependencies(
  source: ContextSource,
  recorded: ReadSet,
): Promise<readonly ContextDependencyReplay[]> {
  const evaluated = await Promise.all(recorded.map(
    async (dependency): Promise<EvaluatedDependency> => {
      let resolution: ContextDependencyResolution;
      let branch = false;
      let bindsStart = false;
      switch (dependency.kind) {
        case "entity":
          bindsStart = dependency.target.kind === "project";
          resolution = await replayEntityDependency(source, dependency);
          break;
        case "membership":
        case "order":
          resolution = await replayCollectionDependency(source, dependency);
          break;
        case "query": {
          const parsed = parseContextRecipe(dependency.query);
          switch (parsed.kind) {
            case "blocked":
            case "unsupported":
              return {
                outcome: { ...parsed, recorded: dependency },
                branch: false, bindsStart: false,
              };
            case "parsed": break;
            default: return assertNever(parsed);
          }
          switch (parsed.recipe.kind) {
            case "predecessor-scenes": branch = true; break;
            case "script-start": bindsStart = true; break;
            case "scene-metadata": case "scene-window":
            case "initial-state": case "reference-bindings": case "search":
              break;
            default: assertNever(parsed.recipe);
          }
          resolution = await replayQueryDependency(source, dependency, parsed.recipe);
          break;
        }
        default: return assertNever(dependency);
      }
      switch (resolution.kind) {
        case "current":
          return {
            outcome: {
              kind: canonicalJson(dependency) === canonicalJson(resolution.current)
                ? "unchanged" : "changed",
              recorded: dependency, current: resolution.current,
            },
            branch, bindsStart,
          };
        case "missing":
        case "unsupported":
        case "blocked":
          return {
            outcome: { ...resolution, recorded: dependency },
            branch, bindsStart,
          };
        default: return assertNever(resolution);
      }
    },
  ));

  const startBound = evaluated.some(item => {
    if (!item.bindsStart) return false;
    switch (item.outcome.kind) {
      case "unchanged": case "changed": return true;
      case "missing": case "unsupported": case "blocked": return false;
      default: return assertNever(item.outcome);
    }
  });
  return evaluated.map((item): ContextDependencyReplay => {
    const outcome = item.outcome;
    switch (outcome.kind) {
      case "unchanged":
        if (item.branch && !startBound) {
          return {
            kind: "blocked", recorded: outcome.recorded,
            reason: "LEGACY_BRANCH_START_UNBOUND",
          };
        }
        return outcome;
      case "changed": case "missing": case "unsupported": case "blocked":
        return outcome;
      default: return assertNever(outcome);
    }
  });
}
