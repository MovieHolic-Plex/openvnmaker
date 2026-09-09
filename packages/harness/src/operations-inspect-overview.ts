import { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type { ReadSet } from "./context-contracts.js";
import type { Candidate } from "./operations.js";
import { hashSchema } from "./primitives.js";
import type { HarnessErrorCode, ProjectHead } from "./primitives.js";
import type { toolArgumentsSchemas } from "./tool-contracts.js";

type QueryDependency = Extract<ReadSet[number], { readonly kind: "query" }>;
export const inspectionOverviewRecipeSchema = z.strictObject({
  kind: z.literal("inspection-project-overview"), version: z.literal(1),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(40),
});
const cursorSchema = z.tuple([
  hashSchema, z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number)
    .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
]);

/** Only projected graph/metadata/page content enters this dependency, not manuscript text. */
export async function inspectionOverviewProjection(
  candidate: Candidate,
  recipe: z.infer<typeof inspectionOverviewRecipeSchema>,
) {
  const { script, productionDocument } = candidate;
  const { title, subtitle, start, artDirection, musicFadeSeconds, credits } = script;
  const metadata = { title, subtitle, start, artDirection, musicFadeSeconds, credits };
  const beats = new Map<string, Candidate["productionDocument"]["outline"]["scenes"][number]>(
    productionDocument.outline.scenes.map(beat => [beat.id, beat]),
  );
  const materialized = new Map(script.scenes.map(scene => [scene.id, scene]));
  const ids = [...materialized.keys(), ...[...beats.keys()].filter(id => !materialized.has(id))];
  const graph = ids.map(sceneId => {
    const scene = materialized.get(sceneId) ?? beats.get(sceneId);
    return {
      sceneId, materialized: materialized.has(sceneId),
      targetSceneIds: scene?.choices?.length ? scene.choices.map(choice => choice.next)
        : !scene?.ending && scene?.next ? [scene.next] : [],
      ...(scene?.ending === undefined ? {} : { ending: scene.ending }),
    };
  });
  const scenes = ids.slice(recipe.offset, recipe.offset + recipe.limit).map(sceneId => {
    const scene = materialized.get(sceneId);
    const beat = beats.get(sceneId);
    return {
      sceneId, chapter: scene?.chapter ?? beat?.chapter ?? "",
      title: beat?.title ?? sceneId, summary: beat?.summary ?? "",
      lineCount: scene?.lines.length ?? 0, choiceCount: scene?.choices?.length ?? 0,
      materialized: scene !== undefined,
    };
  });
  const data = { metadata, graph, scenes };
  const dependency: QueryDependency = {
    kind: "query", query: canonicalJson(recipe),
    scope: [{ kind: "project" }, { kind: "canon", sectionId: "outline" }],
    resultIds: graph.map(node => canonicalJson({ kind: "scene", sceneId: node.sceneId })),
    hash: await canonicalHash(data),
  };
  return { data, dependency, total: ids.length };
}

type OverviewResult =
  | { readonly ok: true; readonly data: Awaited<ReturnType<typeof inspectionOverviewProjection>>["data"] & {
    readonly nextCursor: string | null;
  }; readonly dependency: QueryDependency }
  | { readonly ok: false; readonly code: HarnessErrorCode };

export async function inspectProjectOverview(
  candidate: Candidate,
  sourceHead: ProjectHead,
  args: z.infer<typeof toolArgumentsSchemas.project_overview>,
): Promise<OverviewResult> {
  // Cursor authority is deliberately separate from the replayable content projection.
  const binding = await canonicalHash({
    sourceHead, candidateRef: candidate.ref,
    scriptHash: await canonicalHash(candidate.script),
    productionHash: await canonicalHash(candidate.productionDocument),
  });
  let offset = 0;
  if (args.cursor !== undefined) {
    const cursor = cursorSchema.safeParse(args.cursor.split(":"));
    if (!cursor.success) return { ok: false, code: "INVALID_INPUT" };
    if (cursor.data[0] !== binding) return { ok: false, code: "STALE_HEAD" };
    offset = cursor.data[1];
  }
  const limit = args.limit ?? 20;
  const projection = await inspectionOverviewProjection(candidate, {
    kind: "inspection-project-overview", version: 1, offset, limit,
  });
  if (args.cursor !== undefined && offset >= projection.total) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const end = Math.min(offset + limit, projection.total);
  return {
    ok: true, dependency: projection.dependency,
    data: { ...projection.data, nextCursor: end < projection.total ? `${binding}:${end}` : null },
  };
}
