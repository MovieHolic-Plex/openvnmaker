import type { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import { applyCandidateTool } from "./operations.js";
import type { CandidateToolInput, CandidateToolOutcome } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { ProjectHead, RunId, uuidSchema } from "./primitives.js";
import {
  reuseListEnvelopeSchema, reuseListPatchArtifactSchema,
  reuseListPatchPayloadSchema,
} from "./reuse-artifact-contracts.js";
import type { ReuseListPatchArtifact } from "./reuse-artifact-contracts.js";
import type { ReusePatchPayload } from "./reuse-family.js";

export type ReuseListCaptureInput = {
  readonly artifactId: z.infer<typeof uuidSchema>;
  readonly runId: RunId;
  readonly originHead: ProjectHead;
  readonly operationIds: readonly z.infer<typeof uuidSchema>[];
  readonly before: CandidateToolInput;
  readonly after: CandidateToolOutcome;
};

export type ReuseListCaptureResult =
  | { readonly kind: "ready"; readonly artifact: ReuseListPatchArtifact }
  | { readonly kind: "blocked"; readonly reason:
      "EVIDENCE_MISMATCH" | "UNSUPPORTED_PATCH" };

export async function captureReuseListPatch(
  input: ReuseListCaptureInput,
): Promise<ReuseListCaptureResult> {
  return captureReusePatch(input, {
    kind: "list-patch", envelope: reuseListEnvelopeSchema, payload: reuseListPatchPayloadSchema,
    operationCount: envelope => envelope.arguments.operations.length,
  });
}

type CaptureCodec<P extends ReusePatchPayload> = {
  readonly kind: P["kind"];
  readonly envelope: z.ZodType<P["envelope"]>;
  readonly payload: z.ZodType<P>;
  readonly operationCount: (envelope: P["envelope"]) => number;
};

/** Shared historical verification; callers restrict this to their pure mutation family. */
export async function captureReusePatch<P extends ReusePatchPayload>(
  input: ReuseListCaptureInput,
  codec: CaptureCodec<P>,
): Promise<ReuseListCaptureResult> {
  const envelope = codec.envelope.safeParse(input.before.envelope);
  if (!envelope.success) return { kind: "blocked", reason: "UNSUPPORTED_PATCH" };
  const mismatch = { kind: "blocked", reason: "EVIDENCE_MISMATCH" } as const;
  if (input.operationIds.length !== codec.operationCount(envelope.data) ||
      new Set(input.operationIds).size !== input.operationIds.length ||
      input.before.journal.calls.some(call => call.result.callId === envelope.data.callId)) {
    return mismatch;
  }
  switch (input.after.result.ok) {
    case false: return mismatch;
    case true: break;
    default: return assertNever(input.after.result);
  }
  // Verify a historical transition on private values. Only pure supported tools reach here;
  // this does not dispatch a saved call into the new candidate or persist a receipt.
  const expected = await applyCandidateTool({ ...input.before, envelope: envelope.data });
  if (canonicalJson(expected) !== canonicalJson(input.after)) return mismatch;
  const receipt = input.after.journal.calls.find(call =>
    call.result.callId === envelope.data.callId);
  if (!receipt) return mismatch;
  const payload = codec.payload.safeParse({
    version: 1, kind: codec.kind, artifactId: input.artifactId,
    runId: input.runId, unitId: input.before.unitId, originHead: input.originHead,
    inputRef: input.before.candidate.ref, outputRef: input.after.candidate.ref,
    inputSnapshotHash: await canonicalHash({
      script: input.before.candidate.script,
      productionDocument: input.before.candidate.productionDocument,
    }),
    outputSnapshotHash: await canonicalHash({
      script: input.after.candidate.script,
      productionDocument: input.after.candidate.productionDocument,
    }),
    operationIds: input.operationIds, envelope: envelope.data, receipt,
    allocations: input.after.journal.allocations,
  });
  if (!payload.success) return mismatch;
  return {
    kind: "ready",
    artifact: reuseListPatchArtifactSchema.parse({
      artifactId: input.artifactId,
      artifactHash: await canonicalHash(payload.data), payload: canonicalJson(payload.data),
    }),
  };
}
