import type { Line } from "@vnmaker/content";
import type { z } from "zod";
import { canonicalHash } from "./canonical.js";
import type { ContextSource, SceneContextResult } from "./context.js";
import type { ContextManifest, ReadSet } from "./context-contracts.js";
import { assertNever, lineIdSchema } from "./primitives.js";
import { readReferenceContext } from "./context-reference.js";
import type { LineId } from "./primitives.js";
import type { toolArgumentsSchemas } from "./tool-contracts.js";

/** Reads a parsed candidate snapshot; never assigns identities or changes it. */
export async function readSceneContext(
  source: ContextSource,
  args: z.infer<typeof toolArgumentsSchemas.read_scene>,
): Promise<SceneContextResult> {
  const scene = source.script.scenes.find(value => value.id === args.sceneId);
  if (!scene) return { kind: "blocked", reason: "STALE_TARGET" };
  const { lines: sourceLines, ...metadata } = scene;
  const rows: { readonly id: LineId; readonly line: Line }[] = [];
  for (const line of sourceLines) {
    const id = lineIdSchema.safeParse(line.id);
    if (!id.success) return { kind: "blocked", reason: "STALE_TARGET" };
    rows.push({ id: id.data, line });
  }

  const ids = rows.map(row => row.id);
  const anchor = args.afterLineId === undefined
    ? -1 : ids.indexOf(args.afterLineId);
  if (args.afterLineId !== undefined && anchor === -1) {
    return { kind: "blocked", reason: "STALE_TARGET" };
  }
  const start = anchor + 1;
  const end = Math.min(start + (args.limit ?? 100), rows.length);
  const selected = rows.slice(start, end);
  const lines = selected.map(row => row.line);
  const window: ContextManifest["windows"][number] = {
    sceneId: args.sceneId,
    lineIds: selected.map(row => row.id),
    hash: await canonicalHash(lines),
  };
  const references = await readReferenceContext(source, window);
  switch (references.kind) {
    case "blocked": return references;
    case "ready": break;
    default: return assertNever(references);
  }
  const scope = { kind: "scene", sceneId: args.sceneId } as const;
  const readSet: ReadSet = [
    ...references.readSet,
    { kind: "entity", target: scope, hash: await canonicalHash(scene) },
    {
      kind: "membership", scope, ids: [...ids].sort(),
      hash: await canonicalHash([...ids].sort()),
    },
    { kind: "order", scope, ids, hash: await canonicalHash(ids) },
    ...await Promise.all(selected.map(async (row): Promise<ReadSet[number]> => ({
      kind: "entity",
      target: { kind: "line", sceneId: args.sceneId, lineId: row.id },
      hash: await canonicalHash(row.line),
    }))),
  ];
  const excluded: ContextManifest["excluded"] =
    [...rows.slice(0, start), ...rows.slice(end)].map(
      (row): ContextManifest["excluded"][number] => ({
        target: { kind: "line", sceneId: args.sceneId, lineId: row.id },
        reason: "OUTSIDE_WINDOW",
      }),
    );
  return {
    kind: "ready", metadata, lines, window,
    beforeLineId: rows[start - 1]?.id ?? null,
    afterLineId: rows[end]?.id ?? null,
    readSet, excluded,
    referenceBindings: references.referenceBindings,
    referenceBindingHashes: references.referenceBindingHashes,
  };
}
