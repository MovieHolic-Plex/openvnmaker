import { canonicalHash } from "./canonical.js";
import type { ContextSource } from "./context.js";
import { reuseContextFrameSchema } from "./reuse-dependency-contracts.js";
import type { ReuseContextFrame } from "./reuse-dependency-contracts.js";

export type CaptureReuseContextFrameInput = Pick<ReuseContextFrame,
  "frameId" | "readSet" | "precedingPatchArtifactHashes">;
export type CaptureReuseContextFrameResult = {
  readonly kind: "ready";
  readonly frame: ReuseContextFrame;
};

/** Captures reader output verbatim; replay remains Task8-owned and per frame. */
export async function captureReuseContextFrame(
  source: ContextSource,
  input: CaptureReuseContextFrameInput,
): Promise<CaptureReuseContextFrameResult> {
  return {
    kind: "ready",
    frame: reuseContextFrameSchema.parse({
      version: 1, frameId: input.frameId, sourceHead: source.sourceHead,
      inputRef: source.candidateRef,
      inputSnapshotHash: await canonicalHash({
        script: source.script, productionDocument: source.productionDocument,
      }),
      precedingPatchArtifactHashes: input.precedingPatchArtifactHashes,
      readSet: input.readSet,
    }),
  };
}
