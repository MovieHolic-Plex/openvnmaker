import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical.js";
import { readSetSchema } from "../src/context-contracts.js";
import { hashSchema, unitIdSchema } from "../src/primitives.js";
import type { UnitId } from "../src/primitives.js";
import type { ReuseAnalysis } from "../src/reuse-contracts.js";
import { reuseDependencyUnitSchema } from "../src/reuse-dependency-contracts.js";
import type { ReuseDependencyUnit, ReuseUnitDependency } from "../src/reuse-dependency-contracts.js";
import { propagateReuseDependencies } from "../src/reuse-dependencies.js";

const a = unitIdSchema.parse("00000000-0000-4000-8000-000000000311");
const b = unitIdSchema.parse("00000000-0000-4000-8000-000000000312");
const c = unitIdSchema.parse("00000000-0000-4000-8000-000000000313");
const outputHash = hashSchema.parse("a".repeat(64));
const changedHash = hashSchema.parse("b".repeat(64));
function unit(
  unitId: UnitId,
  classification: ReuseAnalysis["units"][number]["classification"],
  dependencies: readonly ReuseUnitDependency[] = [],
): ReuseDependencyUnit {
  return reuseDependencyUnitSchema.parse({
    result: { unitId, classification, reasons: [], changedDependencies: [] },
    outputArtifactHash: outputHash, dependencies,
  });
}
const dependsOn = (unitId: UnitId): ReuseUnitDependency => ({ unitId, expectedOutputArtifactHash: outputHash });

test("invalidates transitive dependent approvals despite unchanged successful output hashes", () => {
  // Given a reversed input order and a parent whose context requires review.
  const recorded = readSetSchema.parse([0, 1].map(() => ({
    kind: "entity", target: { kind: "line", sceneId: "start", lineId: "l-a" }, hash: outputHash,
  })));
  const parent = unit(a, "needs-review");
  const input = [unit(c, "eligible", [dependsOn(b)]), unit(b, "eligible", [dependsOn(a)]), {
    ...parent, result: { ...parent.result, reasons: ["CONTEXT_CHANGED"], changedDependencies: recorded },
  }];
  const original = canonicalJson(input);
  // When dependency validity is propagated, rather than comparing only output bytes.
  const result = propagateReuseDependencies(input);
  // Then every dependent becomes review-required and original read evidence stays on its own unit.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.units.map(row => [row.unitId, row.classification]), [
    [a, "needs-review"], [b, "needs-review"], [c, "needs-review"],
  ]);
  assert.deepEqual(result.requiredReviews, [a, b, c]);
  assert.deepEqual(result.requiredRepairs, []);
  assert.deepEqual(result.units.find(row => row.unitId === a)?.changedDependencies, recorded);
  assert.deepEqual(result.units.find(row => row.unitId === b)?.changedDependencies, []);
  assert.deepEqual(result.changedUnitDependencies, [
    { unitId: b, dependencies: [dependsOn(a)] }, { unitId: c, dependencies: [dependsOn(b)] },
  ]);
  assert.equal(canonicalJson(input), original);
});

test("detects a changed upstream artifact even when its direct classification is eligible", () => {
  // Given the child names the original output hash while the parent's verified bytes changed.
  const parent = { ...unit(a, "eligible"), outputArtifactHash: changedHash };
  // When the explicit artifact edge is checked.
  const result = propagateReuseDependencies([parent, unit(b, "eligible", [dependsOn(a)])]);
  // Then parent validity is insufficient to promote content generated from a different artifact.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.units.map(row => [row.unitId, row.classification]), [[a, "eligible"], [b, "needs-review"]]);
  assert.deepEqual(result.requiredReviews, [b]);
  assert.deepEqual(result.changedUnitDependencies, [{ unitId: b, dependencies: [dependsOn(a)] }]);
});

test("missing output is unavailable while a dependent target conflict retains its stronger local classification", () => {
  // Given missing parent bytes, a locally conflicting child, and a further dependent.
  const parent = { ...unit(a, "eligible"), outputArtifactHash: null };
  const input = [parent, unit(b, "conflict", [dependsOn(a)]), unit(c, "eligible", [dependsOn(b)])];
  // When negative availability and dependency evidence is propagated.
  const result = propagateReuseDependencies(input);
  // Then intact child bytes are not mislabeled missing, nor is a real target conflict erased.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.units.map(row => [row.unitId, row.classification]), [
    [a, "unavailable"], [b, "conflict"], [c, "needs-review"],
  ]);
  assert.deepEqual(result.requiredReviews, [c]);
  assert.deepEqual(result.requiredRepairs, [b]);
});

const malformed = [
  { name: "missing unit", units: [unit(a, "eligible", [dependsOn(b)])] },
  { name: "cycle", units: [unit(a, "eligible", [dependsOn(b)]), unit(b, "eligible", [dependsOn(a)])] },
  { name: "duplicate unit", units: [unit(a, "eligible"), unit(a, "eligible")] },
  { name: "duplicate edge", units: [unit(a, "eligible"), unit(b, "eligible", [dependsOn(a), dependsOn(a)])] },
];
for (const fixture of malformed) {
  test(`blocks malformed unit dependencies: ${fixture.name}`, () => {
    // Given ambiguous or incomplete immutable unit-edge evidence.
    const original = canonicalJson(fixture.units);
    // When dependency propagation receives that graph.
    const result = propagateReuseDependencies(fixture.units);
    // Then no partial eligible-unit output is returned or silently guessed.
    assert.equal(result.kind, "blocked");
    assert.equal(result.reason, "INVALID_UNIT_DEPENDENCIES");
    assert.equal(canonicalJson(fixture.units), original);
  });
}

test("propagation never promotes independently blocked direct classifications despite retained output hashes", () => {
  // Given independent direct results, including an unknown effect with retained artifact identity.
  const d = unitIdSchema.parse("00000000-0000-4000-8000-000000000314");
  const unavailable = unit(d, "unavailable");
  const input = [unit(a, "eligible"), unit(b, "needs-review"), unit(c, "conflict"), {
    ...unavailable, result: { ...unavailable.result, reasons: ["UNKNOWN_EFFECT"] },
  }];
  // When the negative-only dependency stage sees no upstream edges to invalidate.
  const result = propagateReuseDependencies(input);
  // Then it neither revalidates context nor converts retained hashes into successful outcomes.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.units.map(row => [row.unitId, row.classification]), [
    [a, "eligible"], [b, "needs-review"], [c, "conflict"], [d, "unavailable"],
  ]);
  assert.deepEqual(result.units.find(row => row.unitId === d)?.reasons, ["UNKNOWN_EFFECT"]);
  assert.deepEqual(result.requiredReviews, [b]);
  assert.deepEqual(result.requiredRepairs, [c]);
  assert.deepEqual(result.changedUnitDependencies, []);
});

test("a disconnected valid component cannot leak partial eligibility from a cyclic graph", () => {
  // Given a valid isolated node followed by a separate dependency cycle.
  const input = [unit(a, "eligible"), unit(b, "eligible", [dependsOn(c)]), unit(c, "eligible", [dependsOn(b)])];
  const original = canonicalJson(input);
  // When the whole immutable graph is checked before propagation.
  const result = propagateReuseDependencies(input);
  // Then only the malformed graph result is published, without the otherwise valid unit.
  assert.deepEqual(result, { kind: "blocked", reason: "INVALID_UNIT_DEPENDENCIES", unitIds: [b, c] });
  assert.equal(canonicalJson(input), original);
});
