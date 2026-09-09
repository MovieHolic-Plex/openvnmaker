import { canonicalHash, canonicalJson } from "./canonical.js";
import { buildContextManifest } from "./context.js";
import type { ReadSet, WriteSet } from "./context-contracts.js";
import { assertNever } from "./primitives.js";
import type { ClassifyReuseListUnitInput } from "./reuse-classify.js";
import type { UnitProvenance } from "./reuse-contracts.js";
import type { VerifiedReusePatch } from "./reuse-family.js";

function covers(recorded: readonly string[], required: readonly string[]): boolean {
  const counts = new Map<string, number>();
  for (const value of recorded) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of required) {
    const count = counts.get(value) ?? 0;
    if (count === 0) return false;
    counts.set(value, count - 1);
  }
  return true;
}

function writeIdentity(writes: WriteSet): string {
  const fields = new Map<string, Set<string>>();
  for (const write of writes) {
    const key = canonicalJson(write.target);
    const names = fields.get(key) ?? new Set<string>();
    for (const field of write.fields) names.add(field);
    fields.set(key, names);
  }
  return canonicalJson([...fields].map(([target, names]) => ({ target, fields: [...names].sort() }))
    .sort((left, right) => left.target < right.target ? -1 : left.target > right.target ? 1 : 0));
}

/** Reconcile recorded evidence only. Opaque extra settings cannot be inferred or approved here. */
export async function reuseUnitCoverageReasons(
  input: ClassifyReuseListUnitInput,
  provenance: UnitProvenance,
  patches: readonly VerifiedReusePatch[],
): Promise<readonly string[]> {
  const reasons: string[] = [];
  switch (input.unit.kind) {
    case "scene-draft": case "scene-repair": break;
    case "outline": case "image": case "validation": case "proposal":
      reasons.push("UNSUPPORTED_UNIT_KIND");
      break;
    default: assertNever(input.unit.kind);
  }
  if (provenance.originHead.projectId !== input.evidence.originalBase.sourceHead.projectId ||
      provenance.originHead.lineageId !== input.evidence.originalBase.sourceHead.lineageId) {
    reasons.push("UNVERIFIED_SOURCE_ORIGIN");
  }
  const frames = input.evidence.frames;
  if (frames.length === 0) reasons.push("NO_CAPTURED_FRAMES");
  // This aggregation is coverage accounting, never a cross-frame replay invocation.
  const recorded: ReadSet = frames.flatMap(frame => frame.readSet);
  if (canonicalJson(recorded) !== canonicalJson(provenance.readSet) ||
      !covers(recorded.map(canonicalJson), input.unit.contextManifest.readSet.map(canonicalJson))) {
    reasons.push("INCOMPLETE_READ_EVIDENCE");
  }
  const { inputContentHash, ...manifestInput } = input.unit.contextManifest;
  const manifest = await buildContextManifest(manifestInput);
  switch (manifest.kind) {
    case "ready":
      if (manifest.manifest.inputContentHash !== inputContentHash || inputContentHash !== provenance.inputContentHash) {
        reasons.push("UNVERIFIED_INPUT_CONTENT");
      }
      break;
    case "blocked": case "budget-blocked": reasons.push("UNVERIFIED_INPUT_CONTENT"); break;
    default: assertNever(manifest);
  }
  if (input.evidence.modelBinding === undefined ||
      await canonicalHash(input.evidence.modelBinding) !== provenance.modelBindingHash) {
    reasons.push("UNVERIFIED_MODEL_BINDING");
  }
  const originalBindings = await Promise.all(input.originalBase.productionDocument.referenceBindings.map(canonicalHash));
  const currentBindings = await Promise.all(input.currentBase.productionDocument.referenceBindings.map(canonicalHash));
  if (canonicalJson(input.unit.contextManifest.referenceBindingHashes) !== canonicalJson(provenance.referenceBindingHashes) ||
      !covers(originalBindings, provenance.referenceBindingHashes) || !covers(currentBindings, provenance.referenceBindingHashes)) {
    reasons.push("UNVERIFIED_REFERENCE_BINDINGS");
  }
  const own = patches.filter(row => input.evidence.outputPatchArtifactHashes.includes(row.selection.expectedArtifactHash));
  if (own.length === 0 || !input.evidence.outputPatchArtifactHashes.includes(provenance.outputArtifactHash) ||
      own.some(row => row.patch.unitId !== input.unit.id)) reasons.push("UNSUPPORTED_OUTPUT_LAYOUT");
  if (writeIdentity(own.flatMap(row => row.patch.receipt.result.writeSet)) !== writeIdentity(provenance.writeSet)) {
    reasons.push("INCOMPLETE_WRITE_EVIDENCE");
  }
  for (const { patch } of own) {
    const frameReads = frames.filter(frame => canonicalJson(frame.inputRef) === canonicalJson(patch.inputRef) &&
      frame.inputSnapshotHash === patch.inputSnapshotHash).flatMap(frame => frame.readSet);
    if (!covers(frameReads.map(canonicalJson), patch.receipt.result.readSet.map(canonicalJson))) {
      reasons.push("INCOMPLETE_PATCH_READ_EVIDENCE");
      break;
    }
  }
  return reasons;
}
