import { z } from "zod";
import type { Character, Choice, Line, Scene } from "../../content/src/index.js";
import { canonicalHash } from "./canonical.js";
import type { ContextSource } from "./context.js";
import type { ReadSet } from "./context-contracts.js";
import type { ContextDependencyResolution } from "./context-replay.js";
import {
  contextCanonSection,
  contextCanonSectionIdSchema,
} from "./context-projections.js";
import { assertNever, lineIdSchema } from "./primitives.js";
import type { CanonEntry, CanonSection } from "./production-contracts.js";

type EntityDependency = Extract<ReadSet[number], { kind: "entity" }>;
type CollectionDependency = Extract<ReadSet[number], { kind: "membership" | "order" }>;
type EntityValue =
  | ContextSource["script"] | Scene | Line | Choice | Character
  | CanonEntry | CanonSection | string | number | boolean;

export async function replayEntityDependency(
  source: ContextSource,
  recorded: EntityDependency,
): Promise<ContextDependencyResolution> {
  const target = recorded.target;
  let value: EntityValue | undefined;
  switch (target.kind) {
    case "project":
      value = source.script;
      break;
    case "scene":
      value = source.script.scenes.find(scene => scene.id === target.sceneId);
      break;
    case "line":
      value = source.script.scenes.find(scene => scene.id === target.sceneId)
        ?.lines.find(line => line.id === target.lineId);
      break;
    case "choice":
      value = source.script.scenes.find(scene => scene.id === target.sceneId)
        ?.choices?.find(choice => choice.id === target.choiceId);
      break;
    case "character":
      value = source.script.characters.find(character =>
        character.id === target.characterId);
      break;
    case "state": {
      const flags = source.script.flags ?? {};
      value = Object.hasOwn(flags, target.flagId) ? flags[target.flagId] : undefined;
      break;
    }
    case "canon": {
      const id = contextCanonSectionIdSchema.safeParse(target.sectionId);
      if (!id.success) return { kind: "missing", reason: "TARGET_NOT_FOUND" };
      const section = contextCanonSection(source.productionDocument, id.data);
      if (target.entryId === undefined) {
        value = section;
        break;
      }
      switch (section.kind) {
        case "entries":
          value = section.entries.find(entry => entry.id === target.entryId);
          break;
        case "art-direction":
          value = section.rules.find(entry => entry.id === target.entryId);
          break;
        case "outline":
          return { kind: "unsupported", reason: "UNSUPPORTED_CANON_ENTRY_SCOPE" };
        default: return assertNever(section);
      }
      break;
    }
    case "asset":
      return { kind: "unsupported", reason: "UNSUPPORTED_ASSET_ENTITY_SEMANTICS" };
    default: return assertNever(target);
  }
  if (value === undefined) return { kind: "missing", reason: "TARGET_NOT_FOUND" };
  return {
    kind: "current",
    current: { ...recorded, hash: await canonicalHash(value) },
  };
}

export async function replayCollectionDependency(
  source: ContextSource,
  recorded: CollectionDependency,
): Promise<ContextDependencyResolution> {
  const scope = recorded.scope;
  let ids: readonly string[];
  switch (scope.kind) {
    case "scene": {
      const scene = source.script.scenes.find(value => value.id === scope.sceneId);
      if (!scene) return { kind: "missing", reason: "TARGET_NOT_FOUND" };
      const parsed = z.array(lineIdSchema).safeParse(scene.lines.map(line => line.id));
      if (!parsed.success) {
        return { kind: "blocked", reason: "UNSTABLE_LINE_IDENTITIES" };
      }
      ids = parsed.data;
      break;
    }
    case "canon": {
      if (scope.entryId !== undefined) {
        return { kind: "unsupported", reason: "UNSUPPORTED_COLLECTION_SCOPE" };
      }
      const id = contextCanonSectionIdSchema.safeParse(scope.sectionId);
      if (!id.success) return { kind: "missing", reason: "TARGET_NOT_FOUND" };
      const section = contextCanonSection(source.productionDocument, id.data);
      switch (section.kind) {
        case "entries": ids = section.entries.map(entry => entry.id); break;
        case "art-direction": ids = section.rules.map(entry => entry.id); break;
        case "outline":
          return { kind: "unsupported", reason: "UNSUPPORTED_COLLECTION_SCOPE" };
        default: return assertNever(section);
      }
      break;
    }
    case "project": case "state": case "line": case "choice":
    case "character": case "asset":
      return { kind: "unsupported", reason: "UNSUPPORTED_COLLECTION_SCOPE" };
    default: return assertNever(scope);
  }
  let currentIds: readonly string[];
  switch (recorded.kind) {
    case "membership": currentIds = [...ids].sort(); break;
    case "order": currentIds = ids; break;
    default: return assertNever(recorded);
  }
  return {
    kind: "current",
    current: {
      ...recorded, ids: currentIds, hash: await canonicalHash(currentIds),
    },
  };
}
