import type { Scene } from "@vnmaker/content";
import { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type { ContextSource, SceneContextResult } from "./context.js";
import type { ReadSet } from "./context-contracts.js";
import { assertNever, sceneIdSchema } from "./primitives.js";
import type { CanonSection, ProductionDocument } from "./production-contracts.js";
import type { toolArgumentsSchemas } from "./tool-contracts.js";

type QueryDependency = Extract<ReadSet[number], { kind: "query" }>;
type WindowContent = Pick<
  Extract<SceneContextResult, { kind: "ready" }>,
  "lines" | "window" | "beforeLineId" | "afterLineId"
>;

export const contextCanonSectionIdSchema = z.enum([
  "castCanon", "worldTimeline", "branchFacts", "artDirection", "outline",
]);

export function contextCanonSection(
  document: ProductionDocument,
  sectionId: z.infer<typeof contextCanonSectionIdSchema>,
): CanonSection {
  switch (sectionId) {
    case "castCanon": return { kind: "entries", entries: document.castCanon };
    case "worldTimeline": return { kind: "entries", entries: document.worldTimeline };
    case "branchFacts": return { kind: "entries", entries: document.branchFacts };
    case "artDirection": return { kind: "art-direction", rules: document.artDirection };
    case "outline": return { kind: "outline", outline: document.outline };
    default: return assertNever(sectionId);
  }
}

export async function sceneMetadataDependency(scene: Scene): Promise<QueryDependency> {
  const { lines: _lines, ...metadata } = scene;
  const sceneId = sceneIdSchema.parse(scene.id);
  const target = { kind: "scene", sceneId } as const;
  return {
    kind: "query",
    query: canonicalJson({ kind: "scene-metadata", version: 1, sceneId }),
    scope: [target], resultIds: [canonicalJson(target)],
    hash: await canonicalHash(metadata),
  };
}

export async function sceneWindowDependency(
  args: z.infer<typeof toolArgumentsSchemas.read_scene>,
  content: WindowContent,
): Promise<QueryDependency> {
  return {
    kind: "query",
    query: canonicalJson({
      kind: "scene-window", version: 1, sceneId: args.sceneId,
      afterLineId: args.afterLineId, limit: args.limit ?? 100,
    }),
    scope: [{ kind: "scene", sceneId: args.sceneId }],
    resultIds: content.window.lineIds.map(lineId =>
      canonicalJson({ kind: "line", sceneId: args.sceneId, lineId })),
    hash: await canonicalHash({
      lines: content.lines,
      beforeLineId: content.beforeLineId,
      afterLineId: content.afterLineId,
    }),
  };
}

export async function readStateDependencies(
  script: ContextSource["script"],
): Promise<readonly QueryDependency[]> {
  const flags = script.flags ?? {};
  const start = { kind: "scene", sceneId: sceneIdSchema.parse(script.start) } as const;
  return [
    {
      kind: "query", query: canonicalJson({ kind: "initial-state" }),
      scope: [{ kind: "project" }],
      resultIds: Object.keys(flags).sort().map(flagId =>
        canonicalJson({ kind: "state", flagId })),
      hash: await canonicalHash(flags),
    },
    {
      kind: "query", query: canonicalJson({ kind: "script-start", version: 1 }),
      scope: [{ kind: "project" }], resultIds: [canonicalJson(start)],
      hash: await canonicalHash({ start: script.start }),
    },
  ];
}
