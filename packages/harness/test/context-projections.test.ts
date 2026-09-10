import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { readBranchContext, readSceneContext } from "../src/context.js";
import { sceneIdSchema } from "../src/primitives.js";
import {
  approvedArtBindingSchema,
  canonEntrySchema,
  productionDocumentSchema,
} from "../src/production-contracts.js";
import { scriptSchema } from "../src/script-contracts.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";
import { hash, otherHash } from "./fixtures.js";

const args = toolArgumentsSchemas.read_scene.parse({
  sceneId: "start", afterLineId: "l1", limit: 1,
});

test("emits versioned metadata and window projections for new scene reads", async () => {
  // Given a bounded window and independently known consumed values.
  const source = await selectionSource();
  const scene = source.script.scenes.find(value => value.id === "start");
  assert.ok(scene);
  const { lines, ...metadata } = scene;
  const selected = lines.find(line => line.id === "l2");
  assert.ok(selected);
  const metadataHash = await canonicalHash(metadata);
  const windowHash = await canonicalHash({
    lines: [selected], beforeLineId: "l1", afterLineId: "l3",
  });
  const metadataRecipe = canonicalJson({
    kind: "scene-metadata", version: 1, sceneId: "start",
  });
  const windowRecipe = canonicalJson({
    kind: "scene-window", version: 1, sceneId: "start",
    afterLineId: "l1", limit: 1,
  });
  // When a new scene read succeeds.
  const result = await readSceneContext(source, args);
  // Then its required context uses explicit projections, not a disguised scene entity.
  assert.equal(result.kind, "ready");
  const metadataRead = result.readSet.find(dependency =>
    dependency.kind === "query" && dependency.query === metadataRecipe);
  const windowRead = result.readSet.find(dependency =>
    dependency.kind === "query" && dependency.query === windowRecipe);
  assert.ok(metadataRead);
  assert.ok(windowRead);
  assert.equal(metadataRead.hash, metadataHash);
  assert.equal(windowRead.hash, windowHash);
  assert.equal(result.readSet.some(dependency =>
    dependency.kind === "entity" &&
    dependency.target.kind === "scene"), false);
  assert.ok(result.readSet.some(dependency =>
    dependency.kind === "entity" &&
    dependency.target.kind === "line" &&
    dependency.target.sceneId === "start" &&
    dependency.target.lineId === "l2"));
});

test("does not include unreturned same-scene text in a precise new read", async () => {
  // Given unchanged metadata, IDs, order, selected lines and reference selection.
  const source = await selectionSource();
  const before = await readSceneContext(source, args);
  assert.equal(before.kind, "ready");
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      lines: scene.lines.map(line =>
        line.id === "l3" ? { ...line, text: "Different tail." } : line),
    } : scene),
  });
  // When only excluded text is changed.
  const result = await readSceneContext({ ...source, script }, args);
  // Then the new required-context evidence remains unchanged.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.window, before.window);
  assert.deepEqual(result.readSet, before.readSet);
});

test("retains returned choice metadata as a genuine dependency", async () => {
  // Given changed choice metadata with unchanged selected dialogue.
  const source = await selectionSource();
  const before = await readSceneContext(source, args);
  assert.equal(before.kind, "ready");
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      choices: scene.choices?.map(choice => ({
        ...choice, text: "Changed destination label.",
      })),
    } : scene),
  });
  // When that scene is read again.
  const result = await readSceneContext({ ...source, script }, args);
  // Then metadata changes remain visible to dependency comparison.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.window, before.window);
  assert.notDeepEqual(result.readSet, before.readSet);
});

test("retains full line membership and order beyond the selected window", async () => {
  // Given an additional excluded line with unchanged selected content.
  const source = await selectionSource();
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      lines: [...scene.lines, { id: "l4", speaker: null, text: "New tail." }],
    } : scene),
  });
  // When the bounded window is read.
  const result = await readSceneContext({ ...source, script }, args);
  // Then projection precision does not discard collection dependencies.
  assert.equal(result.kind, "ready");
  const membership = result.readSet.find(dependency => dependency.kind === "membership");
  const order = result.readSet.find(dependency => dependency.kind === "order");
  assert.deepEqual(membership?.ids, ["l1", "l2", "l3", "l4"]);
  assert.deepEqual(order?.ids, ["l1", "l2", "l3", "l4"]);
});

test("retains an excluded prefix actor when reference selection depends on it", async () => {
  // Given an approved character binding and an initially narrator-only prefix.
  const base = await selectionSource();
  const binding = approvedArtBindingSchema.parse({
    assetId: "witness-reference", originalHash: hash, deliveryHash: otherHash,
    referenceVersionIds: ["ref-witness"], role: "reference",
    target: { kind: "character", characterId: "witness" },
  });
  const source = {
    ...base,
    productionDocument: productionDocumentSchema.parse({
      ...base.productionDocument, referenceBindings: [binding],
    }),
  };
  const before = await readSceneContext(source, args);
  assert.equal(before.kind, "ready");
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      lines: scene.lines.map(line =>
        line.id === "l1" ? { ...line, speaker: "witness" } : line),
    } : scene),
  });
  // When an excluded prefix line introduces that actor.
  const result = await readSceneContext({ ...source, script }, args);
  // Then selected dialogue can stay equal while reference dependencies change.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.window, before.window);
  assert.deepEqual(result.referenceBindings, [binding]);
  assert.notDeepEqual(result.readSet, before.readSet);
});

test("binds script start explicitly without changing the legacy flags-only recipe", async () => {
  // Given a route effect that is bypassed when entry moves to the target itself.
  const base = await selectionSource();
  const script = scriptSchema.parse({
    ...base.script, flags: { route: "b" },
    scenes: base.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      choices: scene.choices?.map(choice => ({
        ...choice, set: { route: "a" },
      })),
    } : scene),
  });
  const entry = canonEntrySchema.parse({
    id: "a-route", category: "branch-fact", text: "Route A fact.",
    characterIds: [], sceneIds: ["start"], relatedEntryIds: [],
    truth: { kind: "world" },
    applicability: {
      anyOf: [{ compare: [{ flag: "route", op: "eq", value: "a" }] }],
    },
  });
  const source = {
    ...base, script,
    productionDocument: productionDocumentSchema.parse({
      ...base.productionDocument, branchFacts: [entry],
    }),
  };
  const selection = { sceneId: sceneIdSchema.parse("other"), maxVisitedStates: 100 };
  const before = await readBranchContext(source, selection);
  assert.equal(before.kind, "ready");
  const startRecipe = canonicalJson({ kind: "script-start", version: 1 });
  const flagsRecipe = canonicalJson({ kind: "initial-state" });
  const expectedStart = await canonicalHash({ start: "other" });
  const expectedFlags = await canonicalHash({ route: "b" });
  // When only script.start changes.
  const result = await readBranchContext({
    ...source, script: scriptSchema.parse({ ...script, start: "other" }),
  }, selection);
  // Then start is a separate real input and flags retain their historical meaning.
  assert.equal(result.kind, "ready");
  const oldStart = before.readSet.find(dependency =>
    dependency.kind === "query" && dependency.query === startRecipe);
  const newStart = result.readSet.find(dependency =>
    dependency.kind === "query" && dependency.query === startRecipe);
  const flags = result.readSet.find(dependency =>
    dependency.kind === "query" && dependency.query === flagsRecipe);
  assert.ok(oldStart);
  assert.ok(newStart);
  assert.ok(flags);
  assert.notEqual(newStart.hash, oldStart.hash);
  assert.equal(newStart.hash, expectedStart);
  assert.equal(flags.hash, expectedFlags);
});

test("exposes the whole-scene optimistic hash separately from required context", async () => {
  // Given an original scene whose complete value is needed for optimistic operations.
  const source = await selectionSource();
  const scene = source.script.scenes.find(value => value.id === "start");
  assert.ok(scene);
  const expectedHash = await canonicalHash(scene);
  // When a bounded scene window is read.
  const result = await readSceneContext(source, toolArgumentsSchemas.read_scene.parse({
    sceneId: "start", limit: 1,
  }));
  // Then operation consumers receive the complete control hash independently.
  assert.equal(result.kind, "ready");
  assert.equal(result.sceneHash, expectedHash);
});
