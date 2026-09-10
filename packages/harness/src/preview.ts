import { canonicalHash } from "./canonical.js";
import type { Candidate } from "./operations.js";
import { assertNever } from "./primitives.js";
import type {
  HarnessErrorCode, ProjectHead, Revision, RunId, Sha256,
} from "./primitives.js";
import { scriptSchema } from "./script-contracts.js";
import { previewBoundarySchema, previewSnapshotSchema } from "./snapshot-contracts.js";
import type { PreviewBoundary, PreviewMissingAsset, PreviewSnapshot } from "./snapshot-contracts.js";

export type PreviewSource = {
  /** Preview-scoped missing assets supplied by the asset/validation adapter. */
  readonly missingAssets: readonly PreviewMissingAsset[];
  readonly candidate: Candidate;
  readonly sourceHead: ProjectHead;
  readonly runId: RunId;
  readonly includedUnitHashes: readonly Sha256[];
};

export type PreviewRequest = {
  readonly allowMissingAssetPlaceholders: boolean;
  readonly previewId: PreviewSnapshot["previewId"];
  readonly expectedCandidateRevision: Revision;
  readonly entry: PreviewSnapshot["entry"];
};

export type PreviewBuildResult =
  | { readonly ok: true; readonly snapshot: PreviewSnapshot }
  | { readonly ok: false; readonly code: HarnessErrorCode };

export async function buildPreviewSnapshot(
  source: PreviewSource,
  request: PreviewRequest,
): Promise<PreviewBuildResult> {
  const { candidate } = source;
  if (request.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }
  const parsed = scriptSchema.safeParse(candidate.script);
  if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
  const script = parsed.data;
  const actual = new Set(script.scenes.map(scene => scene.id));
  if (!actual.has(request.entry.sceneId)) return { ok: false, code: "INVALID_INPUT" };
  let initialFlags = { ...script.flags };
  switch (request.entry.kind) {
    case "from-start":
      if (request.entry.sceneId !== script.start) {
        return { ok: false, code: "INVALID_INPUT" };
      }
      break;
    case "assumed-state":
      initialFlags = { ...initialFlags, ...request.entry.flags };
      break;
    default: return assertNever(request.entry);
  }

  const plannedIds = candidate.productionDocument.outline.scenes.map(scene => scene.id);
  const planned = new Set<string>(plannedIds);
  if (planned.size !== plannedIds.length) return { ok: false, code: "INVALID_OPERATION" };
  const knownActors = new Set<string>(script.characters.map(character => character.id));
  const actors = new Set<string>();
  const boundaries: PreviewBoundary[] = [];
  for (const scene of script.scenes) {
    const destinations = [
      ...(scene.next === undefined ? [] : [scene.next]),
      ...(scene.choices ?? []).map(choice => choice.next),
    ];
    if (destinations.some(id => !actual.has(id) && !planned.has(id))) {
      return { ok: false, code: "INVALID_OPERATION" };
    }
    // Boundaries follow existing player exit precedence; manuscript fields stay intact.
    const edges = scene.choices?.length
      ? scene.choices.map(choice => ({
        fromSceneId: scene.id, targetSceneId: choice.next, choiceId: choice.id,
      }))
      : !scene.ending && scene.next !== undefined
        ? [{ fromSceneId: scene.id, targetSceneId: scene.next }]
        : [];
    for (const edge of edges) {
      if (actual.has(edge.targetSceneId)) continue;
      if ("choiceId" in edge && edge.choiceId === undefined) {
        return { ok: false, code: "INVALID_OPERATION" };
      }
      boundaries.push(previewBoundarySchema.parse({
        ...edge, reason: "unwritten-scene",
      }));
    }
    for (const sprite of scene.sprites ?? []) {
      if (sprite.character !== null) actors.add(sprite.character);
    }
    for (const line of scene.lines) {
      if (line.speaker !== null) actors.add(line.speaker);
      for (const sprite of line.sprites ?? []) {
        if (sprite.character !== null) actors.add(sprite.character);
      }
    }
  }
  if ([...actors].some(id => !knownActors.has(id))) {
    return { ok: false, code: "INVALID_OPERATION" };
  }
  const missingAssetIds = new Set(source.missingAssets.map(asset => asset.assetId));
  if (missingAssetIds.size > 0 && !request.allowMissingAssetPlaceholders) {
    return { ok: false, code: "INVALID_STATE" };
  }
  const assetBindings = candidate.productionDocument.referenceBindings.filter(binding => {
    if (missingAssetIds.has(binding.assetId)) return false;
    switch (binding.target.kind) {
      case "character": return actors.has(binding.target.characterId);
      case "scene": return actual.has(binding.target.sceneId);
      default: return assertNever(binding.target);
    }
  });
  // Capture all content before the asynchronous hash, including caller-owned metadata.
  const content = structuredClone({
    kind: "candidate-preview" as const,
    previewId: request.previewId,
    projectId: source.sourceHead.projectId,
    runId: source.runId,
    candidateId: candidate.ref.candidateId,
    candidateRevision: candidate.ref.revision,
    sourceHead: source.sourceHead,
    entry: request.entry,
    materializedScenes: script.scenes,
    cast: script.characters.filter(character => actors.has(character.id)),
    initialFlags,
    assetBindings,
    boundaries,
    includedUnitHashes: source.includedUnitHashes,
    ...(source.missingAssets.length === 0 ? {} : { missingAssets: source.missingAssets }),
  });
  const snapshot = previewSnapshotSchema.safeParse({
    ...content, snapshotHash: await canonicalHash(content),
  });
  if (!snapshot.success) return { ok: false, code: "INVALID_OPERATION" };
  return { ok: true, snapshot: snapshot.data };
}
