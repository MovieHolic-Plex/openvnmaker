import { assertNever } from "./primitives.js";
import type { ContextDependencyReplay } from "./context.js";
import type { Unit } from "./lifecycle-contracts.js";
import type { InspectionQueryReplay } from "./operations-inspect.js";
import type { Candidate } from "./operations.js";
import type { HarnessErrorCode, ProjectHead, Sha256 } from "./primitives.js";
import type { ReuseListPatchSelection } from "./reuse-assembly.js";
import type { ReuseAnalysis } from "./reuse-contracts.js";
import type { ReuseContextFrame } from "./reuse-dependency-contracts.js";
import type { ReuseOutputMaterial, ReuseOutputVerification } from "./reuse-output.js";
import type { ReuseListUnitEvidence } from "./reuse-unit-evidence.js";
import { compareReuseFrameReads } from "./reuse-classify-reads.js";
import { bindReuseTimeline } from "./reuse-classify-timeline.js";
import { reuseUnitCoverageReasons } from "./reuse-classify-coverage.js";
import { verifyReuseOutputArtifact } from "./reuse-output.js";
import { reuseListPatchFamily } from "./reuse-list.js";
import type { ReusePatchFamily, ReusePatchPayload } from "./reuse-family.js";

export type ReuseReadComparison =
  | { readonly owner: "context"; readonly context: ContextDependencyReplay;
      readonly comparison: ContextDependencyReplay["kind"] }
  | { readonly owner: "inspection";
      readonly context: Extract<ContextDependencyReplay, { readonly kind: "unsupported" }>;
      readonly inspection: Extract<InspectionQueryReplay, { readonly kind: "current" }>;
      readonly comparison: "unchanged" | "changed" };
export type ReuseFrameAssessment =
  | { readonly kind: "replayed"; readonly frameId: ReuseContextFrame["frameId"];
      readonly historical: readonly ReuseReadComparison[];
      readonly current: readonly ReuseReadComparison[] }
  | { readonly kind: "prefix-conflict"; readonly frameId: ReuseContextFrame["frameId"];
      readonly historical: readonly ReuseReadComparison[];
      readonly artifactHash: Sha256; readonly reason: HarnessErrorCode | "ARTIFACT_MISMATCH" };
export type ClassifyReuseListUnitInput = {
  readonly unit: Unit;
  readonly evidence: ReuseListUnitEvidence;
  readonly expectedEvidenceHash: Sha256;
  readonly originalBase: Candidate;
  readonly currentBase: Candidate;
  readonly newBaseHead: ProjectHead;
  readonly output: ReuseOutputMaterial;
  readonly patches: readonly ReuseListPatchSelection[];
};
export type ClassifyReuseListUnitResult =
  | { readonly kind: "classified"; readonly direct: ReuseAnalysis["units"][number];
      readonly output: ReuseOutputVerification; readonly frames: readonly ReuseFrameAssessment[] }
  | { readonly kind: "blocked"; readonly reason:
      "EVIDENCE_MISMATCH" | "STALE_HEAD" | "INVALID_INPUT" };

/** Direct evidence classification, before dependency propagation and fresh proposal review. */
export async function classifyReuseListUnit(
  input: ClassifyReuseListUnitInput,
): Promise<ClassifyReuseListUnitResult> {
  return classifyReuseUnit(input, reuseListPatchFamily);
}

export async function classifyReuseUnit<P extends ReusePatchPayload>(
  input: ClassifyReuseListUnitInput,
  family: ReusePatchFamily<P>,
): Promise<ClassifyReuseListUnitResult> {
  const timeline = await bindReuseTimeline(input, family);
  switch (timeline.kind) {
    case "blocked": return timeline;
    case "bound": break;
    default: return assertNever(timeline);
  }
  const output = await verifyReuseOutputArtifact(input.unit, input.output);
  switch (output.kind) {
    case "unavailable": return {
      kind: "classified", output, frames: [],
      direct: { unitId: input.unit.id, classification: "unavailable", reasons: [output.reason], changedDependencies: [] },
    };
    case "verified": break;
    default: return assertNever(output);
  }
  const reasons = [...await reuseUnitCoverageReasons(input, output.provenance, timeline.patches)];
  const changedDependencies: ReuseAnalysis["units"][number]["changedDependencies"][number][] = [];
  const frames: ReuseFrameAssessment[] = [];
  let conflict = false;
  const addReason = (reason: string): void => { if (!reasons.includes(reason)) reasons.push(reason); };
  for (const [index, frame] of input.evidence.frames.entries()) {
    const position = timeline.framePositions[index];
    const state = position === undefined ? undefined : timeline.states[position];
    if (!state) return { kind: "blocked", reason: "EVIDENCE_MISMATCH" };
    const historical = await compareReuseFrameReads({
      sourceHead: frame.sourceHead, candidateRef: state.historical.ref,
      script: state.historical.script, productionDocument: state.historical.productionDocument,
    }, frame.readSet);
    for (const read of historical) {
      switch (read.comparison) {
        case "changed": case "missing": return { kind: "blocked", reason: "EVIDENCE_MISMATCH" };
        case "blocked": case "unsupported": addReason("UNVERIFIED_HISTORICAL_READ"); break;
        case "unchanged": break;
        default: assertNever(read);
      }
    }
    switch (state.current.kind) {
      case "conflict":
        conflict = true;
        addReason(state.current.reason);
        frames.push({ kind: "prefix-conflict", frameId: frame.frameId, historical,
          artifactHash: state.current.artifactHash, reason: state.current.reason });
        continue;
      case "candidate": break;
      default: return assertNever(state.current);
    }
    const current = await compareReuseFrameReads({
      sourceHead: input.newBaseHead, candidateRef: state.current.candidate.ref,
      script: state.current.candidate.script, productionDocument: state.current.candidate.productionDocument,
    }, frame.readSet);
    frames.push({ kind: "replayed", frameId: frame.frameId, historical, current });
    for (const read of current) {
      switch (read.comparison) {
        case "unchanged": break;
        case "changed": case "missing": case "unsupported": case "blocked":
          changedDependencies.push(read.context.recorded);
          addReason(`CONTEXT_${read.comparison.toUpperCase()}`);
          break;
        default: assertNever(read);
      }
    }
  }
  for (const state of timeline.states) {
    switch (state.current.kind) {
      case "candidate": break;
      case "conflict": conflict = true; addReason(state.current.reason); break;
      default: assertNever(state.current);
    }
  }
  return {
    kind: "classified", output, frames,
    direct: { unitId: input.unit.id,
      classification: conflict ? "conflict" : reasons.length > 0 ? "needs-review" : "eligible",
      reasons, changedDependencies },
  };
}
