import { canonicalJson } from "./canonical.js";
import { applySceneOperation } from "./operations-scene.js";
import { assertNever } from "./primitives.js";
import { readReusePatchArtifact } from "./reuse-artifact.js";
import type { ReusePatchFamily } from "./reuse-family.js";
import { reuseSceneMetadataPayloadSchema } from "./reuse-scene-contracts.js";
import type { ReuseSceneMetadataPayload } from "./reuse-scene-contracts.js";

/** No new mutation policy: the frozen scene operation validates the original full scene hash. */
export const reuseSceneMetadataFamily: ReusePatchFamily<ReuseSceneMetadataPayload> = {
  readArtifact: (artifact, expectedHash) => readReusePatchArtifact(artifact, expectedHash, {
    schema: reuseSceneMetadataPayloadSchema, operationCount: () => 1,
  }),
  apply: async (candidate, { patch, selection }) => {
    // New internal assembly identity only. Original arguments, including target/hash/set/unset,
    // are untouched. This is not journal dispatch or a replay of the old call ID.
    const envelope = {
      ...patch.envelope, callId: selection.receiptId,
      candidateId: candidate.ref.candidateId, expectedCandidateRevision: candidate.ref.revision,
    };
    const applied = await applySceneOperation({
      candidate, envelope, unitId: patch.unitId,
      authorizedWriteSet: patch.receipt.requiredWriteSet,
      journal: { candidateId: candidate.ref.candidateId, calls: [], allocations: [] },
    });
    switch (applied.ok) {
      case false: return applied;
      case true:
        if (canonicalJson(applied.mutation.data) !== canonicalJson(patch.receipt.result.data)) {
          return { ok: false, code: "ARTIFACT_MISMATCH" };
        }
        return { ok: true, script: applied.mutation.script };
      default: return assertNever(applied);
    }
  },
};
