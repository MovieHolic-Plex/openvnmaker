import type { VnScript } from "../../content/src/index.js";
import { scriptSchema } from "./script-contracts.js";
import type { AssetInspection, CheckStatus } from "./validation-contracts.js";
import type { RouteWalk } from "./validation-routes.js";

export type TechnicalResult = {
  readonly schema: CheckStatus;
  readonly graph: CheckStatus;
  readonly condition: CheckStatus;
  readonly assets: CheckStatus;
  readonly runtime: CheckStatus;
  readonly requiredAssetsMissing: readonly string[];
};

function missingHashes(
  required: readonly string[],
  present: ReadonlySet<string>,
): readonly string[] {
  return [...new Set(required)].filter(hash => !present.has(hash)).sort();
}

export function inspectAssets(
  required: readonly string[],
  present: readonly string[],
  inspections: readonly AssetInspection[],
): { readonly status: CheckStatus; readonly missing: readonly string[] } {
  const presentSet = new Set(present);
  const missing = missingHashes(required, presentSet);
  if (missing.length > 0) return { status: "fail", missing };
  if (required.length === 0) return { status: "pass", missing };
  const byHash = new Map(inspections.map(row => [row.hash, row.status]));
  let unverified = false;
  for (const hash of required) {
    const status = byHash.get(hash);
    if (status === undefined || status === "missing" || status === "undecodable") unverified = true;
  }
  return { status: unverified ? "unverified" : "pass", missing };
}

export function technicalCoverage(
  script: VnScript,
  walk: RouteWalk,
  planned: ReadonlySet<string>,
  assets: { readonly status: CheckStatus; readonly missing: readonly string[] },
): TechnicalResult {
  const schema = scriptSchema.safeParse(script).success ? "pass" : "fail";
  const graph: CheckStatus = schema === "fail" || walk.brokenLinks.length > 0 ? "fail" : "pass";
  let condition: CheckStatus = "pass";
  if (walk.closedChoiceScenes.length > 0 || walk.effectErrors.length > 0) condition = "fail";
  else if (walk.exceededBound) condition = "unverified";
  let runtime: CheckStatus = "pass";
  if (walk.deadEnds.length > 0) runtime = "fail";
  else if (walk.exceededBound) runtime = "unverified";
  else {
    const written = new Set(script.scenes.map(scene => scene.id));
    const pendingTails = script.scenes.some(scene => {
      const tails = scene.choices?.length
        ? scene.choices.map(choice => choice.next)
        : scene.ending ? [] : scene.next === undefined ? [] : [scene.next];
      return tails.some(target => planned.has(target) && !written.has(target));
    });
    if (walk.paths.length === 0 && !pendingTails) runtime = "fail";
  }
  return {
    schema, graph, condition, assets: assets.status, runtime, requiredAssetsMissing: assets.missing,
  };
}
