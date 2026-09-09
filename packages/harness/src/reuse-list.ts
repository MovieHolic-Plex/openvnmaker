import { insertClientKeys } from "./boundary-refinements.js";
import { canonicalJson } from "./canonical.js";
import { prepareAllocations } from "./operations-allocation.js";
import { applyListOperations } from "./operations-list.js";
import { hasRegisteredChoiceDestinations } from "./operations-targets.js";
import type { Candidate } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { HarnessErrorCode } from "./primitives.js";
import type { ReuseListEnvelope, ReuseListPatchPayload } from "./reuse-artifact-contracts.js";
import { scriptSchema } from "./script-contracts.js";
import { readReuseListPatchArtifact } from "./reuse-artifact.js";
import type { ReusePatchFamily } from "./reuse-family.js";

export const reuseListPatchFamily: ReusePatchFamily<ReuseListPatchPayload> = {
  readArtifact: readReuseListPatchArtifact,
  apply: (candidate, verified) => applyPreservedListPatch(candidate, verified.patch),
};

type PreservedListResult =
  | { readonly ok: true; readonly script: Candidate["script"] }
  | { readonly ok: false; readonly code: HarnessErrorCode | "ARTIFACT_MISMATCH" };

/** Checks retained insertions, including resolved batches containing only a subset. */
export async function preparePreservedListBatch(
  candidate: Candidate,
  patch: ReuseListPatchPayload,
  envelope: ReuseListEnvelope,
): Promise<{ readonly ok: true } | Extract<PreservedListResult, { readonly ok: false }>> {
  const prepared = await prepareAllocations({
    candidate: { ...candidate, ref: patch.inputRef }, envelope,
    unitId: patch.unitId, authorizedWriteSet: patch.receipt.requiredWriteSet,
    journal: {
      candidateId: patch.inputRef.candidateId, calls: [], allocations: patch.allocations,
    },
  });
  switch (prepared.ok) {
    case false: return { ok: false, code: "ARTIFACT_MISMATCH" };
    case true: break;
    default: return assertNever(prepared);
  }
  if (canonicalJson(prepared.allocations) !== canonicalJson(patch.allocations)) {
    return { ok: false, code: "ARTIFACT_MISMATCH" };
  }
  // Check against the batch preimage too: deleting an occupied ID earlier in the
  // batch must not conceal a collision with a supposedly new preserved insertion.
  const insertedKeys = new Set(envelope.arguments.operations.flatMap(insertClientKeys));
  for (const allocation of patch.allocations) {
    if (allocation.unitId !== patch.unitId || !insertedKeys.has(allocation.clientKey)) continue;
    const target = allocation.target;
    const targetScene = candidate.script.scenes.find(row => row.id === target.sceneId);
    let occupied: boolean;
    switch (target.kind) {
      case "line":
        occupied = targetScene?.lines.some(row => row.id === target.lineId) ?? false;
        break;
      case "choice":
        occupied = targetScene?.choices?.some(row => row.id === target.choiceId) ?? false;
        break;
      default: return assertNever(target);
    }
    if (occupied) return { ok: false, code: "ID_PAYLOAD_CONFLICT" };
  }
  return { ok: true };
}

/** Allocation namespace is historical; target/gap preconditions remain unchanged. */
export async function applyPreservedListPatch(
  candidate: Candidate,
  patch: ReuseListPatchPayload,
): Promise<PreservedListResult> {
  const { envelope } = patch;
  const scene = candidate.script.scenes.find(row => row.id === envelope.arguments.sceneId);
  if (!scene) return { ok: false, code: "STALE_TARGET" };
  const prepared = await preparePreservedListBatch(candidate, patch, envelope);
  switch (prepared.ok) {
    case false: return prepared;
    case true: break;
    default: return assertNever(prepared);
  }
  const mutation = await applyListOperations({
    envelope, scene, unitId: patch.unitId, candidateId: patch.inputRef.candidateId,
  });
  switch (mutation.ok) {
    case false: return mutation;
    case true: break;
    default: return assertNever(mutation);
  }
  if (canonicalJson(mutation.data) !== canonicalJson(patch.receipt.result.data)) {
    return { ok: false, code: "ARTIFACT_MISMATCH" };
  }
  switch (envelope.tool) {
    case "patch_lines": break;
    case "patch_choices":
      if (!hasRegisteredChoiceDestinations(candidate, mutation.scene)) {
        return { ok: false, code: "INVALID_OPERATION" };
      }
      break;
    default: return assertNever(envelope);
  }
  const script = scriptSchema.safeParse({
    ...candidate.script,
    scenes: candidate.script.scenes.map(row => row.id === scene.id ? mutation.scene : row),
  });
  return script.success
    ? { ok: true, script: script.data }
    : { ok: false, code: "INVALID_OPERATION" };
}
