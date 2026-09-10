import { canonicalHash, canonicalJson } from "./canonical.js";
import { operationJournalSchema } from "./operations-receipts.js";
import { requiredWriteSet } from "./operations-scope.js";
import type { Sha256 } from "./primitives.js";
import { reuseListPatchPayloadSchema } from "./reuse-artifact-contracts.js";
import type {
  ReuseListPatchArtifact, ReuseListPatchPayload,
} from "./reuse-artifact-contracts.js";
import type { ReuseArtifactRead, ReusePatchCodec, ReusePatchPayload } from "./reuse-family.js";

type ReadArtifactResult = ReuseArtifactRead<ReuseListPatchPayload>;

/** expectedHash must come from retained evidence, not the submitted artifact itself. */
export async function readReuseListPatchArtifact(
  artifact: ReuseListPatchArtifact,
  expectedHash: Sha256,
): Promise<ReadArtifactResult> {
  return readReusePatchArtifact(artifact, expectedHash, {
    schema: reuseListPatchPayloadSchema,
    operationCount: patch => patch.envelope.arguments.operations.length,
  });
}

export async function readReusePatchArtifact<P extends ReusePatchPayload>(
  artifact: ReuseListPatchArtifact,
  expectedHash: Sha256,
  codec: ReusePatchCodec<P>,
): Promise<ReuseArtifactRead<P>> {
  const mismatch = { kind: "blocked", reason: "ARTIFACT_MISMATCH" } as const;
  if (artifact.artifactHash !== expectedHash) return mismatch;
  let decoded: unknown;
  try {
    decoded = JSON.parse(artifact.payload);
  } catch (error) {
    if (error instanceof SyntaxError) return mismatch;
    throw error;
  }
  const parsed = codec.schema.safeParse(decoded);
  if (!parsed.success) return mismatch;
  const patch = parsed.data;
  if (canonicalJson(patch) !== artifact.payload ||
      await canonicalHash(patch) !== expectedHash || patch.artifactId !== artifact.artifactId) {
    return mismatch;
  }
  const { envelope, receipt, inputRef, outputRef } = patch;
  const required = requiredWriteSet(envelope);
  if (patch.operationIds.length !== codec.operationCount(patch) ||
      new Set(patch.operationIds).size !== patch.operationIds.length ||
      inputRef.candidateId !== envelope.candidateId ||
      inputRef.revision !== envelope.expectedCandidateRevision ||
      outputRef.candidateId !== inputRef.candidateId ||
      outputRef.revision !== inputRef.revision + (receipt.result.changed ? 1 : 0) ||
      (patch.inputSnapshotHash !== patch.outputSnapshotHash) !== receipt.result.changed ||
      receipt.unitId !== patch.unitId || receipt.result.callId !== envelope.callId ||
      canonicalJson(receipt.result.candidateRef) !== canonicalJson(outputRef) ||
      receipt.payloadHash !== await canonicalHash({ unitId: patch.unitId, envelope }) ||
      canonicalJson(receipt.requiredWriteSet) !== canonicalJson(required) ||
      canonicalJson(receipt.result.writeSet) !== canonicalJson(receipt.result.changed ? required : [])) {
    return mismatch;
  }
  const journal = operationJournalSchema.safeParse({
    candidateId: inputRef.candidateId, calls: [receipt], allocations: patch.allocations,
  });
  if (!journal.success) return mismatch;
  return { kind: "ready", patch };
}
