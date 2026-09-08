import { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type {
  ContextSearchHit, ContextSource, SearchContextResult,
} from "./context.js";
import type { ReadSet, Target } from "./context-contracts.js";
import {
  assertNever, choiceIdSchema, hashSchema, lineIdSchema, sceneIdSchema,
} from "./primitives.js";
import type { toolArgumentsSchemas } from "./tool-contracts.js";

const cursorSchema = z.tuple([
  hashSchema,
  z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number)
    .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
]);

/** Search only the supplied approved snapshot; preserve authored text and canon. */
export async function searchContext(
  source: ContextSource,
  args: z.infer<typeof toolArgumentsSchemas.search_content>,
): Promise<SearchContextResult> {
  const query = args.query.normalize("NFC").toLowerCase().normalize("NFC");
  const kinds = [...new Set(args.kinds)].sort();
  const scenes = source.script.scenes.filter(scene =>
    args.sceneId === undefined || scene.id === args.sceneId);
  if (args.sceneId !== undefined && scenes.length === 0) {
    return { kind: "blocked", reason: "STALE_TARGET" };
  }
  const scope: Target[] = args.sceneId === undefined
    ? [{ kind: "project" }]
    : [{ kind: "scene", sceneId: args.sceneId }];
  const records: {
    readonly target: Target;
    readonly hit: ContextSearchHit;
  }[] = [];
  const matches = (text: string): boolean =>
    text.normalize("NFC").toLowerCase().normalize("NFC").includes(query);

  for (const kind of kinds) {
    switch (kind) {
      case "line":
        for (const scene of scenes) {
          const sceneId = sceneIdSchema.parse(scene.id);
          for (const line of scene.lines) {
            if (!matches(line.text)) continue;
            const id = lineIdSchema.safeParse(line.id);
            if (!id.success) return { kind: "blocked", reason: "STALE_TARGET" };
            const target = { kind: "line", sceneId, lineId: id.data } as const;
            records.push({
              target,
              hit: { ...target, text: line.text, hash: await canonicalHash(line) },
            });
          }
        }
        break;
      case "choice":
        for (const scene of scenes) {
          const sceneId = sceneIdSchema.parse(scene.id);
          for (const choice of scene.choices ?? []) {
            if (!matches(choice.text)) continue;
            const id = choiceIdSchema.safeParse(choice.id);
            if (!id.success) return { kind: "blocked", reason: "STALE_TARGET" };
            const target = {
              kind: "choice", sceneId, choiceId: id.data,
            } as const;
            records.push({
              target,
              hit: {
                ...target, text: choice.text, hash: await canonicalHash(choice),
              },
            });
          }
        }
        break;
      case "canon":
        for (const sectionId of [
          "castCanon", "worldTimeline", "branchFacts", "artDirection",
        ] as const) {
          scope.push({ kind: "canon", sectionId });
          for (const entry of source.productionDocument[sectionId]) {
            if (args.sceneId !== undefined && entry.sceneIds.length > 0 &&
                !entry.sceneIds.includes(args.sceneId)) continue;
            if (!matches(entry.text)) continue;
            const target = {
              kind: "canon", sectionId, entryId: entry.id,
            } as const;
            records.push({
              target,
              hit: { ...target, entry, hash: await canonicalHash(entry) },
            });
          }
        }
        break;
      default: assertNever(kind);
    }
  }

  // The recipe excludes paging and authority, so dependencies describe the query.
  const recipe = canonicalJson({ query, kinds, sceneId: args.sceneId });
  const results = records.map(record => ({
    id: canonicalJson(record.target), hash: record.hit.hash,
  }));
  const queryHash = await canonicalHash({ query: recipe, scope, results });
  // Cursor freshness is separate from dependency/content identity.
  const binding = await canonicalHash({
    sourceHead: source.sourceHead,
    candidateRef: source.candidateRef,
    queryHash,
  });
  let offset = 0;
  if (args.cursor !== undefined) {
    const cursor = cursorSchema.safeParse(args.cursor.split(":"));
    if (!cursor.success) return { kind: "blocked", reason: "INVALID_INPUT" };
    if (cursor.data[0] !== binding) {
      return { kind: "blocked", reason: "STALE_HEAD" };
    }
    offset = cursor.data[1];
    if (offset >= records.length) {
      return { kind: "blocked", reason: "INVALID_INPUT" };
    }
  }

  const end = Math.min(offset + (args.limit ?? 20), records.length);
  const readSet: ReadSet = [
    {
      kind: "query", query: recipe, scope,
      resultIds: results.map(result => result.id), hash: queryHash,
    },
    ...records.map((record): ReadSet[number] => ({
      kind: "entity", target: record.target, hash: record.hit.hash,
    })),
  ];
  return {
    kind: "ready",
    hits: records.slice(offset, end).map(record => record.hit),
    readSet,
    nextCursor: end < records.length ? `${binding}:${end}` : null,
  };
}
