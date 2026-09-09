import type { z } from "zod";
import type { Candidate } from "./operations.js";
import type { HarnessErrorCode, Sha256 } from "./primitives.js";
import type { ToolEnvelope } from "./tool-contracts.js";
import type { ReuseListPatchArtifact, ReuseListPatchPayload } from "./reuse-artifact-contracts.js";
import type { ReuseListPatchSelection } from "./reuse-assembly.js";

/** Shared immutable receipt/preimage fields, not a new mutation policy. */
export type ReusePatchPayload = Omit<ReuseListPatchPayload, "kind" | "envelope"> & {
  readonly kind: string;
  readonly envelope: ToolEnvelope;
};
export type ReuseArtifactRead<P extends ReusePatchPayload> =
  | { readonly kind: "ready"; readonly patch: P }
  | { readonly kind: "blocked"; readonly reason: "ARTIFACT_MISMATCH" };
export type ReusePatchCodec<P extends ReusePatchPayload> = {
  readonly schema: z.ZodType<P>;
  readonly operationCount: (patch: P) => number;
};
export type VerifiedReusePatch<P extends ReusePatchPayload = ReusePatchPayload> = {
  readonly selection: ReuseListPatchSelection;
  readonly patch: P;
};
export type ReusePatchApplication =
  | { readonly ok: true; readonly script: Candidate["script"] }
  | { readonly ok: false; readonly code: HarnessErrorCode | "ARTIFACT_MISMATCH" };
/** Only fixed domain-owned families are supplied by the public entry points. */
export type ReusePatchFamily<P extends ReusePatchPayload> = {
  readonly readArtifact: (artifact: ReuseListPatchArtifact, expectedHash: Sha256) => Promise<ReuseArtifactRead<P>>;
  readonly apply: (candidate: Candidate, verified: VerifiedReusePatch<P>) => Promise<ReusePatchApplication>;
};
