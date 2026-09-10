import type { z } from "zod";
import { canonicalJson } from "./canonical.js";
import type { Candidate } from "./operations.js";
import { assertNever, candidateRefSchema } from "./primitives.js";
import type { HarnessErrorCode, ProjectHead, Sha256, uuidSchema } from "./primitives.js";
import { reuseAssemblyReceiptSchema } from "./reuse-artifact-contracts.js";
import type {
  ReuseAssemblyReceipt, ReuseListPatchArtifact,
} from "./reuse-artifact-contracts.js";
import { reuseListPatchFamily } from "./reuse-list.js";
import { prepareReuseAssembly } from "./reuse-preflight.js";
import type { ReusePatchFamily, ReusePatchPayload } from "./reuse-family.js";

export type ReuseListPatchSelection = {
  readonly artifact: ReuseListPatchArtifact;
  readonly expectedArtifactHash: Sha256;
  readonly receiptId: z.infer<typeof uuidSchema>;
};

export type ReuseListAssemblyInput = {
  readonly base: Candidate;
  readonly newBaseHead: ProjectHead;
  readonly patches: readonly ReuseListPatchSelection[];
};

export type ReuseListAssemblyResult =
  | { readonly kind: "ready"; readonly candidate: Candidate;
      readonly receipts: readonly ReuseAssemblyReceipt[] }
  | { readonly kind: "blocked"; readonly reason:
      HarnessErrorCode | "ARTIFACT_MISMATCH" };

/** Mechanical private assembly only; context eligibility/approval is a separate gate. */
export async function assembleReuseListPatches(
  input: ReuseListAssemblyInput,
): Promise<ReuseListAssemblyResult> {
  return assembleReusePatches(input, reuseListPatchFamily);
}

/** Shared atomic assembly; field/precondition policy remains with each operation-owned family. */
export async function assembleReusePatches<P extends ReusePatchPayload>(
  input: ReuseListAssemblyInput,
  family: ReusePatchFamily<P>,
): Promise<ReuseListAssemblyResult> {
  const { base, newBaseHead } = input;
  const prepared = await prepareReuseAssembly(input, family.readArtifact);
  switch (prepared.kind) {
    case "blocked": return prepared;
    case "ready": break;
    default: return assertNever(prepared);
  }
  const { verified } = prepared;
  // Nothing is published until every selected batch has passed on its ordered preimage.
  let script = base.script;
  for (const entry of verified) {
    const applied = await family.apply({ ...base, script }, entry);
    switch (applied.ok) {
      case false: return { kind: "blocked", reason: applied.code };
      case true: script = applied.script; break;
      default: return assertNever(applied);
    }
  }
  const ref = candidateRefSchema.parse({
    candidateId: base.ref.candidateId,
    revision: canonicalJson(script) === canonicalJson(base.script) ? 0 : 1,
  });
  const receipts = verified.map(({ selection, patch }) => reuseAssemblyReceiptSchema.parse({
    receiptId: selection.receiptId, candidateRef: ref, newBaseHead,
    reusedFrom: {
      runId: patch.runId, unitId: patch.unitId,
      artifactHash: selection.expectedArtifactHash, originHead: patch.originHead,
    },
  }));
  return { kind: "ready", candidate: { ...base, ref, script }, receipts };
}
