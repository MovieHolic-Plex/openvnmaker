import { canonicalHash, canonicalJson } from "./canonical.js";
import type { AllocationReceipt } from "./operations-receipts.js";
import type { Candidate } from "./operations.js";
import { assertNever, candidateRefSchema } from "./primitives.js";
import type { Sha256, UnitId } from "./primitives.js";
import { reuseAssemblyReceiptSchema } from "./reuse-artifact-contracts.js";
import type { ReuseAssemblyReceipt } from "./reuse-artifact-contracts.js";
import type {
  ReuseListAssemblyInput, ReuseListAssemblyResult,
} from "./reuse-assembly.js";
import type { Resolution } from "./reuse-contracts.js";
import { prepareReuseListAssembly } from "./reuse-preflight.js";
import type { VerifiedReuseListPatch } from "./reuse-preflight.js";
import { applyResolvedReusePatch } from "./reuse-resolution-list.js";
import { planReuseListResolutions } from "./reuse-resolution-plan.js";

export type ResolvedReuseListAssemblyInput = ReuseListAssemblyInput & {
  readonly resolutions: readonly Resolution[];
};

export type ResolvedReuseListAssemblyResult =
  | {
      readonly kind: "ready";
      readonly candidate: Candidate;
      readonly receipts: readonly ReuseAssemblyReceipt[];
      readonly allocations: readonly AllocationReceipt[];
      readonly resolutionDigest: Sha256;
      readonly repairUnitIds: readonly UnitId[];
    }
  | {
      readonly kind: "blocked";
      readonly reason: Extract<ReuseListAssemblyResult, { readonly kind: "blocked" }>["reason"]
        | "UNSUPPORTED_RESOLUTION";
    };

/** Explicit candidate-only resolution; neither context eligibility nor source authority. */
export async function assembleResolvedReuseListPatches(
  input: ResolvedReuseListAssemblyInput,
): Promise<ResolvedReuseListAssemblyResult> {
  const prepared = await prepareReuseListAssembly(input);
  switch (prepared.kind) {
    case "blocked": return prepared;
    case "ready": break;
    default: return assertNever(prepared);
  }
  const plan = planReuseListResolutions(prepared.verified, input.resolutions);
  switch (plan.kind) {
    case "blocked": return plan;
    case "ready": break;
    default: return assertNever(plan);
  }
  let script = input.base.script;
  let allocations: readonly AllocationReceipt[] = [];
  const reused: VerifiedReuseListPatch[] = [];
  for (const item of plan.patches) {
    const applied = await applyResolvedReusePatch({ ...input.base, script }, item, allocations);
    switch (applied.kind) {
      case "blocked": return applied;
      case "ready":
        script = applied.script;
        allocations = applied.allocations;
        if (applied.reused) reused.push(item.verified);
        break;
      default: return assertNever(applied);
    }
  }
  const ref = candidateRefSchema.parse({
    candidateId: input.base.ref.candidateId,
    revision: canonicalJson(script) === canonicalJson(input.base.script) ? 0 : 1,
  });
  const candidate = { ...input.base, ref, script };
  const receipts = reused.map(({ selection, patch }) => reuseAssemblyReceiptSchema.parse({
    receiptId: selection.receiptId, candidateRef: ref, newBaseHead: input.newBaseHead,
    reusedFrom: {
      runId: patch.runId, unitId: patch.unitId,
      artifactHash: selection.expectedArtifactHash, originHead: patch.originHead,
    },
  }));
  const resolutionDigest = await canonicalHash({
    version: 1, newBaseHead: input.newBaseHead, candidateRef: ref,
    sourceArtifacts: input.patches.map(({ artifact, expectedArtifactHash, receiptId }) => ({
      artifactId: artifact.artifactId, artifactHash: expectedArtifactHash, receiptId,
    })),
    resolutions: input.resolutions, allocations, repairUnitIds: plan.repairUnitIds,
    scriptHash: await canonicalHash(script),
    productionHash: await canonicalHash(candidate.productionDocument),
  });
  return { kind: "ready", candidate, receipts, allocations, resolutionDigest,
    repairUnitIds: plan.repairUnitIds };
}
