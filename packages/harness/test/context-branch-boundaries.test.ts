import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { readBranchContext } from "../src/context.js";
import { sceneIdSchema } from "../src/primitives.js";
import { scriptSchema } from "../src/script-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

test("records predecessor snapshots without importing unrelated scene entities", async () => {
  // Given a target, its predecessor, and an unrelated disconnected scene.
  const base = await selectionSource();
  const script = scriptSchema.parse({
    ...base.script,
    scenes: [
      ...base.script.scenes,
      {
        id: "elsewhere", background: "title",
        lines: [{ id: "l1", speaker: null, text: "Unrelated." }],
        ending: "End",
      },
    ],
  });
  const source = { ...base, script };
  const predecessor = script.scenes.find(scene => scene.id === "start");
  assert.ok(predecessor);
  const expectedHash = await canonicalHash(predecessor);
  // When branch context is derived for the target.
  const result = await readBranchContext(source, {
    sceneId: sceneIdSchema.parse("other"), maxVisitedStates: 100,
  });
  // Then the actual predecessor snapshot is recorded, not the unrelated entity.
  assert.equal(result.kind, "ready");
  assert.ok(result.readSet.some(dependency =>
    dependency.kind === "entity" &&
    dependency.target.kind === "scene" &&
    dependency.target.sceneId === "start" &&
    dependency.hash === expectedHash));
  assert.equal(result.readSet.some(dependency =>
    dependency.kind === "entity" &&
    dependency.target.kind === "scene" &&
    dependency.target.sceneId === "elsewhere"), false);
});

test("records predecessor discovery membership so new predecessors are detectable", async () => {
  // Given a known two-scene predecessor closure.
  const source = await selectionSource();
  const recipe = canonicalJson({
    kind: "predecessor-scenes", sceneId: "other",
  });
  // When branch dependencies are collected.
  const result = await readBranchContext(source, {
    sceneId: sceneIdSchema.parse("other"), maxVisitedStates: 100,
  });
  // Then discovery itself is recorded in addition to existing entity values.
  assert.equal(result.kind, "ready");
  const discovery = result.readSet.find(dependency =>
    dependency.kind === "query" && dependency.query === recipe);
  assert.ok(discovery);
  assert.equal(discovery.kind, "query");
  assert.deepEqual(discovery.scope, [{ kind: "project" }]);
  assert.deepEqual(discovery.resultIds, [
    canonicalJson({ kind: "scene", sceneId: "other" }),
    canonicalJson({ kind: "scene", sceneId: "start" }),
  ]);
});

test("preserves original fact provenance and hashes the complete canon entry", async () => {
  // Given approved canon whose truth attribution is a character belief.
  const source = await selectionSource();
  const entry = source.productionDocument.worldTimeline[0];
  assert.ok(entry);
  const expectedHash = await canonicalHash(entry);
  // When branch context is read from that snapshot.
  const result = await readBranchContext(source, {
    sceneId: sceneIdSchema.parse("other"), maxVisitedStates: 100,
  });
  // Then full content and immutable source provenance remain distinct.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.conditional, [entry]);
  assert.deepEqual(result.facts, [{
    factId: entry.id,
    sourceHead: source.sourceHead,
    sceneIds: entry.sceneIds,
    lineIds: [],
    sourceHash: expectedHash,
  }]);
});

test("propagates bounded traversal failure without producing partial dependencies", async () => {
  // Given an unbounded changing-state loop with an available target exit.
  const base = await selectionSource();
  const script = scriptSchema.parse({
    ...base.script, flags: { score: 0 },
    scenes: base.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      choices: [
        { id: "again", text: "Again", next: "start", add: { score: 1 } },
        ...(scene.choices ?? []),
      ],
    } : scene),
  });
  // When branch reading is constrained by a finite visited-state limit.
  const result = await readBranchContext({ ...base, script }, {
    sceneId: sceneIdSchema.parse("other"), maxVisitedStates: 3,
  });
  // Then incomplete traversal remains a typed block.
  assert.deepEqual(result, {
    kind: "blocked", reason: "STATE_BOUND_EXCEEDED",
  });
});
