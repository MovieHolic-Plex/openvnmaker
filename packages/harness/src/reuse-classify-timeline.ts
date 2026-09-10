import { canonicalHash, canonicalJson } from "./canonical.js";
import type { Candidate } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { HarnessErrorCode, Sha256 } from "./primitives.js";
import type { ClassifyReuseListUnitInput } from "./reuse-classify.js";
import { prepareReuseAssembly } from "./reuse-preflight.js";
import { reuseListPatchFamily } from "./reuse-list.js";
import type { ReuseListPatchPayload } from "./reuse-artifact-contracts.js";
import type { ReusePatchFamily, ReusePatchPayload, VerifiedReusePatch } from "./reuse-family.js";

type CurrentPrefix =
  | { readonly kind: "candidate"; readonly candidate: Candidate }
  | { readonly kind: "conflict"; readonly artifactHash: Sha256;
      readonly reason: HarnessErrorCode | "ARTIFACT_MISMATCH" };
export type ReusePrefixState = {
  readonly historical: Candidate;
  readonly historicalHash: Sha256;
  readonly current: CurrentPrefix;
};
type TimelineResult<P extends ReusePatchPayload> =
  | { readonly kind: "bound"; readonly states: readonly ReusePrefixState[];
      readonly framePositions: readonly number[]; readonly patches: readonly VerifiedReusePatch<P>[] }
  | { readonly kind: "blocked"; readonly reason: "EVIDENCE_MISMATCH" | "STALE_HEAD" | "INVALID_INPUT" };

export async function bindReuseUnitTimeline(input: ClassifyReuseListUnitInput): Promise<TimelineResult<ReuseListPatchPayload>> {
  return bindReuseTimeline(input, reuseListPatchFamily);
}

export async function bindReuseTimeline<P extends ReusePatchPayload>(
  input: ClassifyReuseListUnitInput,
  family: ReusePatchFamily<P>,
): Promise<TimelineResult<P>> {
  const mismatch = { kind: "blocked", reason: "EVIDENCE_MISMATCH" } as const;
  const { evidence, originalBase } = input;
  if (await canonicalHash(evidence) !== input.expectedEvidenceHash ||
      await canonicalHash(input.unit) !== evidence.unitHash ||
      canonicalJson(originalBase.ref) !== canonicalJson(evidence.originalBase.inputRef) ||
      canonicalJson(evidence.originalBase.sourceHead) !== canonicalJson(input.unit.contextManifest.sourceHead)) {
    return mismatch;
  }
  const originalHash = await canonicalHash({ script: originalBase.script, productionDocument: originalBase.productionDocument });
  if (originalHash !== evidence.originalBase.inputSnapshotHash) return mismatch;
  if (evidence.originalBase.sourceHead.projectId !== input.newBaseHead.projectId ||
      evidence.originalBase.sourceHead.lineageId !== input.newBaseHead.lineageId) {
    return { kind: "blocked", reason: "STALE_HEAD" };
  }
  const suppliedHashes = input.patches.map(row => row.expectedArtifactHash);
  if (canonicalJson(suppliedHashes) !== canonicalJson(evidence.patchArtifactHashes) ||
      new Set(suppliedHashes).size !== suppliedHashes.length ||
      new Set(evidence.outputPatchArtifactHashes).size !== evidence.outputPatchArtifactHashes.length ||
      evidence.outputPatchArtifactHashes.some(hash => !suppliedHashes.includes(hash))) return mismatch;
  const prepared = await prepareReuseAssembly({
    base: input.currentBase, newBaseHead: input.newBaseHead, patches: input.patches,
  }, family.readArtifact);
  switch (prepared.kind) {
    case "blocked":
      return prepared.reason === "STALE_HEAD"
        ? { kind: "blocked", reason: "STALE_HEAD" } : mismatch;
    case "ready": break;
    default: return assertNever(prepared);
  }
  const states: ReusePrefixState[] = [{
    historical: originalBase, historicalHash: originalHash,
    current: { kind: "candidate", candidate: input.currentBase },
  }];
  for (const { patch, selection } of prepared.verified) {
    const previous = states.at(-1);
    if (!previous || canonicalJson(previous.historical.ref) !== canonicalJson(patch.inputRef) ||
        previous.historicalHash !== patch.inputSnapshotHash) return mismatch;
    const original = await family.apply(previous.historical, { patch, selection });
    switch (original.ok) {
      case false: return mismatch;
      case true: break;
      default: return assertNever(original);
    }
    const historical = { ...previous.historical, ref: patch.outputRef, script: original.script };
    const historicalHash = await canonicalHash({
      script: historical.script, productionDocument: historical.productionDocument,
    });
    if (historicalHash !== patch.outputSnapshotHash) return mismatch;
    let current: CurrentPrefix;
    switch (previous.current.kind) {
      case "conflict": current = previous.current; break;
      case "candidate": {
        const applied = await family.apply(previous.current.candidate, { patch, selection });
        switch (applied.ok) {
          case false:
            current = { kind: "conflict", artifactHash: selection.expectedArtifactHash, reason: applied.code };
            break;
          case true:
            current = { kind: "candidate", candidate: { ...previous.current.candidate, script: applied.script } };
            break;
          default: return assertNever(applied);
        }
        break;
      }
      default: return assertNever(previous.current);
    }
    states.push({ historical, historicalHash, current });
  }
  const frameIds = new Set<string>();
  const framePositions: number[] = [];
  for (const frame of evidence.frames) {
    const position = frame.precedingPatchArtifactHashes.length;
    const state = states[position];
    if (!state || frameIds.has(frame.frameId) ||
        canonicalJson(frame.sourceHead) !== canonicalJson(evidence.originalBase.sourceHead) ||
        canonicalJson(frame.precedingPatchArtifactHashes) !== canonicalJson(suppliedHashes.slice(0, position)) ||
        canonicalJson(frame.inputRef) !== canonicalJson(state.historical.ref) ||
        frame.inputSnapshotHash !== state.historicalHash) return mismatch;
    frameIds.add(frame.frameId);
    framePositions.push(position);
  }
  return { kind: "bound", states, framePositions, patches: prepared.verified };
}
