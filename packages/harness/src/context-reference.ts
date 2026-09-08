import { canonicalHash, canonicalJson } from "./canonical.js";
import type { ContextSource, ReferenceContextResult } from "./context.js";
import type { ContextManifest } from "./context-contracts.js";
import { assertNever } from "./primitives.js";

/** The window comes from the same immutable candidate snapshot. */
export async function readReferenceContext(
  source: ContextSource,
  window: ContextManifest["windows"][number],
): Promise<ReferenceContextResult> {
  const scene = source.script.scenes.find(value => value.id === window.sceneId);
  if (!scene) return { kind: "blocked", reason: "STALE_TARGET" };
  const lastId = window.lineIds.at(-1);
  const end = lastId === undefined
    ? scene.lines.length
    : scene.lines.findIndex(line => line.id === lastId) + 1;
  if (lastId !== undefined && end === 0) {
    return { kind: "blocked", reason: "STALE_TARGET" };
  }

  // Declared scene/prefix characters, not a claim about rendered visibility.
  const characterIds = new Set<string>();
  for (const sprite of scene.sprites ?? []) {
    if (sprite.character !== null) characterIds.add(sprite.character);
  }
  for (const line of scene.lines.slice(0, end)) {
    if (line.speaker !== null) characterIds.add(line.speaker);
    for (const sprite of line.sprites ?? []) {
      if (sprite.character !== null) characterIds.add(sprite.character);
    }
  }
  const referenceBindings = source.productionDocument.referenceBindings.filter(binding => {
    const target = binding.target;
    switch (target.kind) {
      case "scene":
        return target.sceneId === window.sceneId &&
          (target.lineId === undefined || window.lineIds.includes(target.lineId));
      case "character":
        return characterIds.has(target.characterId);
      default: return assertNever(target);
    }
  });
  const referenceBindingHashes = await Promise.all(
    referenceBindings.map(binding => canonicalHash(binding)),
  );
  return {
    kind: "ready", referenceBindings, referenceBindingHashes,
    readSet: [{
      kind: "query",
      query: canonicalJson({
        kind: "reference-bindings",
        sceneId: window.sceneId,
        lineIds: window.lineIds,
      }),
      scope: [{ kind: "scene", sceneId: window.sceneId }],
      resultIds: referenceBindings.map(binding => canonicalJson({
        assetId: binding.assetId, role: binding.role, target: binding.target,
      })),
      hash: await canonicalHash(referenceBindings),
    }],
  };
}
