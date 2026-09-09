import type { ChoiceOperation, LineOperation } from "./operation-contracts.js";
import { assertNever } from "./primitives.js";
import type { UnitId } from "./primitives.js";
import type { Resolution } from "./reuse-contracts.js";
import type { VerifiedReuseListPatch } from "./reuse-preflight.js";

export type ResolvedListOperation =
  | { readonly kind: "preserve"; readonly operation: LineOperation | ChoiceOperation }
  | { readonly kind: "omit" }
  | { readonly kind: "fields";
      readonly operation: Extract<LineOperation | ChoiceOperation, { readonly kind: "update" }>;
      readonly resolution: Extract<Resolution, { readonly kind: "use-candidate-fields" }> };
export type ResolvedReusePatch =
  | { readonly action: "preserve"; readonly verified: VerifiedReuseListPatch }
  | { readonly action: "omit"; readonly verified: VerifiedReuseListPatch }
  | { readonly action: "edit"; readonly verified: VerifiedReuseListPatch;
      readonly steps: readonly ResolvedListOperation[] }
  | { readonly action: "copy"; readonly verified: VerifiedReuseListPatch;
      readonly resolution: Extract<Resolution, { readonly kind: "insert-as-new" }> };
type ResolutionPlanResult =
  | { readonly kind: "ready"; readonly patches: readonly ResolvedReusePatch[];
      readonly repairUnitIds: readonly UnitId[] }
  | { readonly kind: "blocked"; readonly reason:
      "INVALID_INPUT" | "ARTIFACT_MISMATCH" | "UNSUPPORTED_RESOLUTION" };

export function planReuseListResolutions(
  verified: readonly VerifiedReuseListPatch[],
  resolutions: readonly Resolution[],
): ResolutionPlanResult {
  const operationIds = new Set(verified.flatMap(row => row.patch.operationIds));
  const selected = new Map<string, Resolution>();
  const repairUnitIds: UnitId[] = [];
  for (const resolution of resolutions) {
    let ids: readonly string[];
    switch (resolution.kind) {
      case "keep-source": ids = resolution.operationIds; break;
      case "use-candidate-fields": ids = [resolution.operationId]; break;
      case "insert-as-new": {
        const source = verified.find(row => row.patch.artifactId === resolution.sourceArtifactId);
        if (!source) return { kind: "blocked", reason: "INVALID_INPUT" };
        const operations = source.patch.envelope.arguments.operations;
        const operation = operations[0];
        if (operations.length !== 1 || !operation) {
          return { kind: "blocked", reason: "UNSUPPORTED_RESOLUTION" };
        }
        switch (operation.kind) {
          case "insert": break;
          case "update": case "delete": case "move":
            return { kind: "blocked", reason: "UNSUPPORTED_RESOLUTION" };
          default: return assertNever(operation);
        }
        ids = source.patch.operationIds;
        break;
      }
      case "regenerate-unit":
        ids = verified.filter(row => row.patch.unitId === resolution.unitId)
          .flatMap(row => row.patch.operationIds);
        if (ids.length === 0) return { kind: "blocked", reason: "INVALID_INPUT" };
        repairUnitIds.push(resolution.unitId);
        break;
      default: return assertNever(resolution);
    }
    for (const id of ids) {
      if (!operationIds.has(id) || selected.has(id)) {
        return { kind: "blocked", reason: "INVALID_INPUT" };
      }
      selected.set(id, resolution);
    }
  }
  const patches: ResolvedReusePatch[] = [];
  for (const row of verified) {
    const steps: ResolvedListOperation[] = [];
    let copy: Extract<Resolution, { readonly kind: "insert-as-new" }> | undefined;
    for (const [index, operation] of row.patch.envelope.arguments.operations.entries()) {
      const id = row.patch.operationIds[index];
      if (id === undefined) return { kind: "blocked", reason: "ARTIFACT_MISMATCH" };
      const resolution = selected.get(id);
      if (resolution === undefined) {
        steps.push({ kind: "preserve", operation });
        continue;
      }
      switch (resolution.kind) {
        case "keep-source": case "regenerate-unit": steps.push({ kind: "omit" }); break;
        case "insert-as-new": copy = resolution; break;
        case "use-candidate-fields":
          switch (operation.kind) {
            case "update": steps.push({ kind: "fields", operation, resolution }); break;
            case "insert": case "delete": case "move":
              return { kind: "blocked", reason: "UNSUPPORTED_RESOLUTION" };
            default: return assertNever(operation);
          }
          break;
        default: return assertNever(resolution);
      }
    }
    if (copy !== undefined) patches.push({ action: "copy", verified: row, resolution: copy });
    else if (steps.every(step => step.kind === "omit")) patches.push({ action: "omit", verified: row });
    else if (steps.every(step => step.kind === "preserve")) patches.push({ action: "preserve", verified: row });
    else patches.push({ action: "edit", verified: row, steps });
  }
  return { kind: "ready", patches, repairUnitIds: repairUnitIds.sort() };
}
