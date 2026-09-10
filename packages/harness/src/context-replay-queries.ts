import type { Line } from "../../content/src/index.js";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type { ContextSource } from "./context.js";
import type { ReadSet } from "./context-contracts.js";
import { readPredecessorDependencies } from "./context-branch.js";
import {
  readStateDependencies,
  sceneMetadataDependency,
} from "./context-projections.js";
import { readSceneContext } from "./context-read.js";
import { readReferenceContext } from "./context-reference.js";
import { searchContext } from "./context-search.js";
import type { ContextRecipe } from "./context-replay-recipes.js";
import type { ContextDependencyResolution } from "./context-replay.js";
import { assertNever } from "./primitives.js";

type QueryDependency = Extract<ReadSet[number], { kind: "query" }>;

export async function replayQueryDependency(
  source: ContextSource,
  recorded: QueryDependency,
  recipe: ContextRecipe,
): Promise<ContextDependencyResolution> {
  function selectQuery(readSet: ReadSet, query?: string): ContextDependencyResolution {
    const current = readSet.filter(dependency => dependency.kind === "query")
      .find(dependency => query === undefined || dependency.query === query);
    return current
      ? { kind: "current", current: { ...current, query: recorded.query } }
      : { kind: "blocked", reason: "REPLAY_DEPENDENCY_MISSING" };
  }

  switch (recipe.kind) {
    case "scene-metadata": {
      const scene = source.script.scenes.find(value => value.id === recipe.sceneId);
      if (!scene) return { kind: "missing", reason: "TARGET_NOT_FOUND" };
      const current = await sceneMetadataDependency(scene);
      return { kind: "current", current: { ...current, query: recorded.query } };
    }
    case "scene-window": {
      const result = await readSceneContext(source, {
        sceneId: recipe.sceneId, limit: recipe.limit,
        ...(recipe.afterLineId === undefined ? {} : { afterLineId: recipe.afterLineId }),
      });
      switch (result.kind) {
        case "blocked": return { kind: "blocked", reason: result.reason };
        case "ready": return selectQuery(result.readSet, canonicalJson(recipe));
        default: return assertNever(result);
      }
    }
    case "script-start":
      return selectQuery(
        await readStateDependencies(source.script),
        canonicalJson({ kind: "script-start", version: 1 }),
      );
    case "initial-state":
      return selectQuery(
        await readStateDependencies(source.script),
        canonicalJson({ kind: "initial-state" }),
      );
    case "predecessor-scenes": {
      if (!source.script.scenes.some(scene => scene.id === recipe.sceneId)) {
        return { kind: "missing", reason: "TARGET_NOT_FOUND" };
      }
      return selectQuery(
        await readPredecessorDependencies(source, recipe.sceneId),
        canonicalJson(recipe),
      );
    }
    case "reference-bindings": {
      const scene = source.script.scenes.find(value => value.id === recipe.sceneId);
      if (!scene) return { kind: "missing", reason: "TARGET_NOT_FOUND" };
      const lines: Line[] = [];
      for (const id of recipe.lineIds) {
        const line = scene.lines.find(value => value.id === id);
        if (!line) return { kind: "missing", reason: "TARGET_NOT_FOUND" };
        lines.push(line);
      }
      const result = await readReferenceContext(source, {
        sceneId: recipe.sceneId, lineIds: recipe.lineIds,
        hash: await canonicalHash(lines),
      });
      switch (result.kind) {
        case "blocked": return { kind: "blocked", reason: result.reason };
        case "ready": return selectQuery(result.readSet, canonicalJson(recipe));
        default: return assertNever(result);
      }
    }
    case "search": {
      const result = await searchContext(source, {
        query: recipe.query, kinds: recipe.kinds,
        ...(recipe.sceneId === undefined ? {} : { sceneId: recipe.sceneId }),
      });
      switch (result.kind) {
        case "blocked": return { kind: "blocked", reason: result.reason };
        case "ready": return selectQuery(result.readSet);
        default: return assertNever(result);
      }
    }
    default: return assertNever(recipe);
  }
}
