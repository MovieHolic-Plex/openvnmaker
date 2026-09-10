import { canonicalHash, canonicalJson } from "./canonical.js";
import { assertNever } from "./primitives.js";
import type { HarnessErrorCode } from "./primitives.js";
import { readReuseListPatchArtifact } from "./reuse-artifact.js";
import type { ReuseListPatchPayload } from "./reuse-artifact-contracts.js";
import type { ReuseListAssemblyInput } from "./reuse-assembly.js";
import type { ReuseArtifactRead, ReusePatchPayload, VerifiedReusePatch } from "./reuse-family.js";
import type { ReuseListPatchArtifact } from "./reuse-artifact-contracts.js";
import type { Sha256 } from "./primitives.js";

export type VerifiedReuseListPatch = VerifiedReusePatch<ReuseListPatchPayload>;
type PreflightResult<P extends ReusePatchPayload> =
  | { readonly kind: "ready"; readonly verified: readonly VerifiedReusePatch<P>[] }
  | { readonly kind: "blocked"; readonly reason: HarnessErrorCode | "ARTIFACT_MISMATCH" };

/** Shared evidence checks; intentionally does not evaluate target applicability. */
export async function prepareReuseListAssembly(input: ReuseListAssemblyInput): Promise<PreflightResult<ReuseListPatchPayload>> {
  return prepareReuseAssembly(input, readReuseListPatchArtifact);
}

export async function prepareReuseAssembly<P extends ReusePatchPayload>(
  input: ReuseListAssemblyInput,
  readArtifact: (artifact: ReuseListPatchArtifact, expectedHash: Sha256) => Promise<ReuseArtifactRead<P>>,
): Promise<PreflightResult<P>> {
  const { base, newBaseHead } = input;
  if (base.ref.revision !== 0 || input.patches.length === 0) {
    return { kind: "blocked", reason: "INVALID_INPUT" };
  }
  if (await canonicalHash(base.script) !== newBaseHead.scriptHash ||
      await canonicalHash(base.productionDocument) !== newBaseHead.productionHash) {
    return { kind: "blocked", reason: "STALE_HEAD" };
  }
  const verified: VerifiedReusePatch<P>[] = [];
  const artifactIds = new Set<string>();
  const receiptIds = new Set<string>();
  const operationIds = new Set<string>();
  const callKeys = new Set<string>();
  const originalCallIds = new Set<string>();
  const frames = new Map<string, P>();
  const allocations = new Map<string, string>();
  for (const selection of input.patches) {
    const read = await readArtifact(selection.artifact, selection.expectedArtifactHash);
    switch (read.kind) {
      case "blocked": return read;
      case "ready": break;
      default: return assertNever(read);
    }
    const patch = read.patch;
    if (patch.originHead.projectId !== newBaseHead.projectId ||
        patch.originHead.lineageId !== newBaseHead.lineageId ||
        patch.inputRef.candidateId === base.ref.candidateId) {
      return { kind: "blocked", reason: "STALE_HEAD" };
    }
    const callKey = canonicalJson([patch.inputRef.candidateId, patch.envelope.callId]);
    if (artifactIds.has(patch.artifactId) || receiptIds.has(selection.receiptId) ||
        callKeys.has(callKey) || patch.operationIds.some(id => operationIds.has(id))) {
      return { kind: "blocked", reason: "ID_PAYLOAD_CONFLICT" };
    }
    const previous = frames.get(patch.inputRef.candidateId);
    if (previous && (patch.inputRef.revision < previous.outputRef.revision ||
        patch.inputRef.revision === previous.outputRef.revision &&
        patch.inputSnapshotHash !== previous.outputSnapshotHash)) {
      return { kind: "blocked", reason: "ARTIFACT_MISMATCH" };
    }
    frames.set(patch.inputRef.candidateId, patch);
    for (const allocation of patch.allocations) {
      const key = canonicalJson([patch.inputRef.candidateId, allocation.unitId, allocation.clientKey]);
      const value = canonicalJson(allocation);
      const prior = allocations.get(key);
      if (prior !== undefined && prior !== value) {
        return { kind: "blocked", reason: "ARTIFACT_MISMATCH" };
      }
      allocations.set(key, value);
    }
    artifactIds.add(patch.artifactId);
    receiptIds.add(selection.receiptId);
    callKeys.add(callKey);
    originalCallIds.add(patch.envelope.callId);
    for (const id of patch.operationIds) operationIds.add(id);
    verified.push({ selection, patch });
  }
  if ([...receiptIds].some(id => originalCallIds.has(id))) {
    return { kind: "blocked", reason: "ID_PAYLOAD_CONFLICT" };
  }
  return { kind: "ready", verified };
}
