import type { Issue } from "./review-contracts.js";
import type { Target } from "./context-contracts.js";
import { hashSchema, identifierSchema, sceneIdSchema } from "./primitives.js";

const EMPTY_HASH = "0".repeat(64);

export function sceneTarget(sceneId: string): Target {
  return { kind: "scene", sceneId: sceneIdSchema.parse(sceneId) };
}

export function assetTarget(assetId: string): Target {
  return { kind: "asset", assetId: identifierSchema.parse(assetId) };
}

export function issueId(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const hex = (hash >>> 0).toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

export function makeIssue(
  seed: string,
  category: Issue["category"],
  severity: Issue["severity"],
  targets: readonly Target[],
  requestedChange: string,
  excerpt?: string,
): Issue {
  const id = issueId(seed);
  const evidence = excerpt === undefined || targets[0] === undefined ? [] : [{
    target: targets[0], sourceHash: hashSchema.parse(EMPTY_HASH), excerpt,
  }];
  return { id, repairFamilyId: id, category, severity, targets, evidence, requestedChange };
}

export { EMPTY_HASH };
