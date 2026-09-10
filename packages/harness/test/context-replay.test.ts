import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { readBranchContext, replayContextDependencies } from "../src/context.js";
import type { ContextSource } from "../src/context.js";
import { readDependencySchema } from "../src/context-contracts.js";
import { sceneIdSchema } from "../src/primitives.js";
import { scriptSchema } from "../src/script-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

async function legacyFrame(source: ContextSource) {
  const scene = source.script.scenes.find(value => value.id === "start");
  assert.ok(scene);
  const line = scene.lines.find(value => value.id === "l1");
  assert.ok(line);
  return {
    scene,
    sceneRead: readDependencySchema.parse({
      kind: "entity", target: { kind: "scene", sceneId: "start" },
      hash: await canonicalHash(scene),
    }),
    lineRead: readDependencySchema.parse({
      kind: "entity",
      target: { kind: "line", sceneId: "start", lineId: "l1" },
      hash: await canonicalHash(line),
    }),
  };
}

test("preserves replay order and duplicates without dropping unsupported records", async () => {
  // Given repeated real entity evidence around an unknown recipe.
  const source = await selectionSource();
  const frame = await legacyFrame(source);
  const unknown = readDependencySchema.parse({
    kind: "query", query: canonicalJson({ kind: "future-context", version: 99 }),
    scope: [{ kind: "project" }], resultIds: [], hash: await canonicalHash([]),
  });
  const recorded = [frame.lineRead, unknown, frame.lineRead];
  // When the captured frame is replayed.
  const result = await replayContextDependencies(source, recorded);
  // Then every record retains its position and unsupported evidence is explicit.
  assert.deepEqual(result.map(outcome => outcome.kind), [
    "unchanged", "unsupported", "unchanged",
  ]);
  assert.deepEqual(result.map(outcome => outcome.recorded), recorded);
});

test("keeps historical full-scene entity semantics after excluded text changes", async () => {
  // Given an explicitly recorded full-scene dependency, not a new projection.
  const source = await selectionSource();
  const frame = await legacyFrame(source);
  const scene = {
    ...frame.scene,
    lines: frame.scene.lines.map(line =>
      line.id === "l3" ? { ...line, text: "Changed excluded text." } : line),
  };
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(value =>
      value.id === "start" ? scene : value),
  });
  const expectedHash = await canonicalHash(scene);
  // When that old evidence is replayed.
  const result = await replayContextDependencies(
    { ...source, script }, [frame.sceneRead],
  );
  // Then the old record still means the complete scene.
  assert.equal(result.length, 1);
  const outcome = result[0];
  assert.ok(outcome);
  assert.equal(outcome.kind, "changed");
  assert.deepEqual(outcome.recorded, frame.sceneRead);
  assert.equal(outcome.current.hash, expectedHash);
});

test("reports a missing scoped line without retargeting its sibling-scene namesake", async () => {
  // Given a deleted target line while the same bare ID remains in another scene.
  const source = await selectionSource();
  const frame = await legacyFrame(source);
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: scene.lines.filter(line => line.id !== "l1"),
    } : scene),
  });
  // When the old scoped evidence is replayed.
  const result = await replayContextDependencies(
    { ...source, script }, [frame.lineRead],
  );
  // Then absence remains explicit and the original identity is retained.
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "missing");
  assert.deepEqual(result[0]?.recorded, frame.lineRead);
});

test("blocks malformed recipe replay rather than returning unchanged or an empty list", async () => {
  // Given a structurally valid dependency with an unparseable recipe.
  const source = await selectionSource();
  const recorded = readDependencySchema.parse({
    kind: "query", query: "{broken",
    scope: [{ kind: "project" }], resultIds: [], hash: await canonicalHash([]),
  });
  // When recipe semantics are replayed.
  const result = await replayContextDependencies(source, [recorded]);
  // Then the failure is attached to that record.
  assert.equal(result.length, 1);
  const outcome = result[0];
  assert.ok(outcome);
  assert.equal(outcome.kind, "blocked");
  assert.equal(outcome.reason, "INVALID_RECIPE");
  assert.deepEqual(outcome.recorded, recorded);
});

test("blocks legacy branch completeness without pretending flags bind script start", async () => {
  // Given historical branch evidence lacking the new explicit start record.
  const source = await selectionSource();
  const branch = await readBranchContext(source, {
    sceneId: sceneIdSchema.parse("other"), maxVisitedStates: 100,
  });
  assert.equal(branch.kind, "ready");
  const startRecipe = canonicalJson({ kind: "script-start", version: 1 });
  const predecessorRecipe = canonicalJson({
    kind: "predecessor-scenes", sceneId: "other",
  });
  const flagsRecipe = canonicalJson({ kind: "initial-state" });
  const recorded = branch.readSet.filter(dependency =>
    !(dependency.kind === "query" && dependency.query === startRecipe));
  const expectedFlags = await canonicalHash(source.script.flags ?? {});
  // When that historical frame is replayed without original start evidence.
  const result = await replayContextDependencies(source, recorded);
  // Then incomplete branch evidence blocks eligibility while flags stay flags-only.
  const predecessor = result.find(outcome =>
    outcome.recorded.kind === "query" &&
    outcome.recorded.query === predecessorRecipe);
  const flags = result.find(outcome =>
    outcome.recorded.kind === "query" &&
    outcome.recorded.query === flagsRecipe);
  assert.ok(predecessor);
  assert.ok(flags);
  assert.equal(predecessor.kind, "blocked");
  assert.equal(predecessor.reason, "LEGACY_BRANCH_START_UNBOUND");
  assert.equal(flags.kind, "unchanged");
  assert.equal(flags.current.hash, expectedFlags);
});
