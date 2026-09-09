import { prepareAllocations } from "./operations-allocation.js";
import { applyListOperations } from "./operations-list.js";
import { hasRegisteredChoiceDestinations } from "./operations-targets.js";
import type { AllocationReceipt } from "./operations-receipts.js";
import { requiredWriteSet } from "./operations-scope.js";
import type { Candidate } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { CandidateId, HarnessErrorCode } from "./primitives.js";
import type { ReuseListEnvelope } from "./reuse-artifact-contracts.js";
import { applyPreservedListPatch, preparePreservedListBatch } from "./reuse-list.js";
import { buildCopiedListEnvelope, buildResolvedListEnvelope } from "./reuse-resolution-envelope.js";
import type { ResolvedReusePatch } from "./reuse-resolution-plan.js";
import { scriptSchema } from "./script-contracts.js";

type ResolvedPatchResult =
  | { readonly kind: "ready"; readonly script: Candidate["script"];
      readonly allocations: readonly AllocationReceipt[]; readonly reused: boolean }
  | { readonly kind: "blocked"; readonly reason:
      HarnessErrorCode | "ARTIFACT_MISMATCH" | "UNSUPPORTED_RESOLUTION" };

export async function applyResolvedReusePatch(
  candidate: Candidate,
  item: ResolvedReusePatch,
  allocations: readonly AllocationReceipt[],
): Promise<ResolvedPatchResult> {
  const { patch } = item.verified;
  let envelope: ReuseListEnvelope;
  let namespace: CandidateId;
  let nextAllocations = allocations;
  switch (item.action) {
    case "omit": return { kind: "ready", script: candidate.script, allocations, reused: false };
    case "preserve": {
      const result = await applyPreservedListPatch(candidate, patch);
      switch (result.ok) {
        case false: return { kind: "blocked", reason: result.code };
        case true: return { kind: "ready", script: result.script, allocations, reused: true };
        default: return assertNever(result);
      }
    }
    case "edit": {
      const built = buildResolvedListEnvelope(item);
      switch (built.kind) {
        case "blocked": return built;
        case "ready": envelope = built.envelope; break;
        default: return assertNever(built);
      }
      const prepared = await preparePreservedListBatch(candidate, patch, envelope);
      switch (prepared.ok) {
        case false: return { kind: "blocked", reason: prepared.code };
        case true: break;
        default: return assertNever(prepared);
      }
      namespace = patch.inputRef.candidateId;
      break;
    }
    case "copy": {
      const built = buildCopiedListEnvelope(candidate, item);
      switch (built.kind) {
        case "blocked": return built;
        case "ready": envelope = built.envelope; break;
        default: return assertNever(built);
      }
      const prepared = await prepareAllocations({
        candidate, envelope, unitId: patch.unitId, authorizedWriteSet: requiredWriteSet(envelope),
        journal: { candidateId: candidate.ref.candidateId, calls: [], allocations },
      });
      switch (prepared.ok) {
        case false: return { kind: "blocked", reason: prepared.code };
        case true: nextAllocations = prepared.allocations; break;
        default: return assertNever(prepared);
      }
      namespace = candidate.ref.candidateId;
      break;
    }
    default: return assertNever(item);
  }
  const scene = candidate.script.scenes.find(row => row.id === envelope.arguments.sceneId);
  if (!scene) return { kind: "blocked", reason: "STALE_TARGET" };
  const applied = await applyListOperations({
    envelope, scene, unitId: patch.unitId, candidateId: namespace,
  });
  switch (applied.ok) {
    case false: return { kind: "blocked", reason: applied.code };
    case true: break;
    default: return assertNever(applied);
  }
  switch (envelope.tool) {
    case "patch_lines": break;
    case "patch_choices":
      if (!hasRegisteredChoiceDestinations(candidate, applied.scene)) {
        return { kind: "blocked", reason: "INVALID_OPERATION" };
      }
      break;
    default: return assertNever(envelope);
  }
  const parsed = scriptSchema.safeParse({
    ...candidate.script,
    scenes: candidate.script.scenes.map(row => row.id === scene.id ? applied.scene : row),
  });
  return parsed.success
    ? { kind: "ready", script: parsed.data, allocations: nextAllocations, reused: true }
    : { kind: "blocked", reason: "INVALID_OPERATION" };
}
