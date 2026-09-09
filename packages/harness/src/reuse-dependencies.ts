import { assertNever } from "./primitives.js";
import type { UnitId } from "./primitives.js";
import type { ReuseAnalysis } from "./reuse-contracts.js";
import type { ReuseDependencyUnit, ReuseUnitDependency } from "./reuse-dependency-contracts.js";

export type ReuseDependencyResult =
  | {
      readonly kind: "ready";
      readonly units: ReuseAnalysis["units"];
      readonly requiredReviews: ReuseAnalysis["requiredReviews"];
      readonly requiredRepairs: ReuseAnalysis["requiredRepairs"];
      readonly changedUnitDependencies: readonly {
        readonly unitId: UnitId;
        readonly dependencies: readonly ReuseUnitDependency[];
      }[];
    }
  | {
      readonly kind: "blocked";
      readonly reason: "INVALID_UNIT_DEPENDENCIES";
      readonly unitIds: readonly UnitId[];
    };

/** Private graph state; input evidence and its recorded reads are never mutated. */
type DependencyNode = {
  readonly input: ReuseDependencyUnit;
  readonly parents: { readonly dependency: ReuseUnitDependency; readonly node: DependencyNode }[];
  readonly children: DependencyNode[];
  pending: number;
  result: ReuseAnalysis["units"][number];
};

/** Negative propagation only: cannot establish direct context eligibility or source authority. */
export function propagateReuseDependencies(
  units: readonly ReuseDependencyUnit[],
): ReuseDependencyResult {
  const nodes = new Map<UnitId, DependencyNode>();
  const invalid = new Set<UnitId>();
  for (const input of units) {
    const id = input.result.unitId;
    if (nodes.has(id)) {
      invalid.add(id);
      continue;
    }
    nodes.set(id, { input, parents: [], children: [], pending: 0, result: input.result });
  }
  for (const node of nodes.values()) {
    const seen = new Set<UnitId>();
    for (const dependency of node.input.dependencies) {
      const parent = nodes.get(dependency.unitId);
      if (!parent || seen.has(dependency.unitId)) {
        invalid.add(node.input.result.unitId);
        invalid.add(dependency.unitId);
        continue;
      }
      seen.add(dependency.unitId);
      node.parents.push({ dependency, node: parent });
      parent.children.push(node);
      node.pending += 1;
    }
  }
  if (invalid.size > 0) {
    return { kind: "blocked", reason: "INVALID_UNIT_DEPENDENCIES", unitIds: [...invalid].sort() };
  }
  // Kahn's order is completed before classifications are derived. A disconnected
  // valid component cannot leak partial results when another component is cyclic.
  const ordered = [...nodes.values()].filter(node => node.pending === 0);
  for (const node of ordered) {
    for (const child of node.children) {
      child.pending -= 1;
      if (child.pending === 0) ordered.push(child);
    }
  }
  if (ordered.length !== nodes.size) {
    return {
      kind: "blocked", reason: "INVALID_UNIT_DEPENDENCIES",
      unitIds: [...nodes.values()].filter(node => node.pending > 0)
        .map(node => node.input.result.unitId).sort(),
    };
  }
  const changedUnitDependencies: {
    readonly unitId: UnitId;
    readonly dependencies: readonly ReuseUnitDependency[];
  }[] = [];
  for (const node of ordered) {
    let classification = node.input.result.classification;
    const reasons = [...node.input.result.reasons];
    const appendReason = (reason: string): void => {
      if (!reasons.includes(reason)) reasons.push(reason);
    };
    if (node.input.outputArtifactHash === null) {
      classification = "unavailable";
      appendReason("OUTPUT_UNAVAILABLE");
    }
    const changed = node.parents.filter(({ dependency, node: parent }) =>
      parent.input.outputArtifactHash !== dependency.expectedOutputArtifactHash ||
      parent.result.classification !== "eligible");
    if (changed.length > 0) {
      if (changed.some(({ dependency, node: parent }) =>
        parent.input.outputArtifactHash !== dependency.expectedOutputArtifactHash)) {
        appendReason("DEPENDENCY_ARTIFACT_CHANGED");
      }
      if (changed.some(({ node: parent }) => parent.result.classification !== "eligible")) {
        appendReason("DEPENDENCY_NOT_CURRENT");
      }
      switch (classification) {
        case "eligible": classification = "needs-review"; break;
        case "needs-review": case "conflict": case "unavailable": break;
        default: return assertNever(classification);
      }
      changedUnitDependencies.push({
        unitId: node.input.result.unitId,
        dependencies: changed.map(parent => parent.dependency),
      });
    }
    node.result = { ...node.input.result, classification, reasons };
  }
  const byId = (left: { readonly unitId: UnitId }, right: { readonly unitId: UnitId }): number =>
    left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0;
  const results = ordered.map(node => node.result).sort(byId);
  return {
    kind: "ready", units: results,
    requiredReviews: results.filter(result => result.classification === "needs-review")
      .map(result => result.unitId),
    requiredRepairs: results.filter(result => result.classification === "conflict")
      .map(result => result.unitId),
    changedUnitDependencies: changedUnitDependencies.sort(byId),
  };
}
