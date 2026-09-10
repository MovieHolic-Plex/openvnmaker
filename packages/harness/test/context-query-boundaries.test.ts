import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical.js";
import { searchContext } from "../src/context.js";
import { candidateRefSchema } from "../src/primitives.js";
import { scriptSchema } from "../src/script-contracts.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

const args = toolArgumentsSchemas.search_content.parse({
  query: "caf\u00e9", kinds: ["line"], sceneId: "start", limit: 1,
});

test("changes query content identity when matching text changes without new IDs", async () => {
  // Given the same matching IDs with changed authored content.
  const source = await selectionSource();
  const before = await searchContext(source, args);
  assert.equal(before.kind, "ready");
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      lines: scene.lines.map(line =>
        line.id === "l1" ? { ...line, text: "Changed caf\u00e9" } : line),
    } : scene),
  });
  // When the changed snapshot is searched.
  const result = await searchContext({
    ...source, script,
    candidateRef: candidateRefSchema.parse({
      ...source.candidateRef, revision: 5,
    }),
  }, args);
  // Then content changes are detected independently of result membership.
  assert.equal(result.kind, "ready");
  const prior = before.readSet.find(dependency => dependency.kind === "query");
  const current = result.readSet.find(dependency => dependency.kind === "query");
  assert.ok(prior);
  assert.ok(current);
  assert.deepEqual(current.resultIds, [
    canonicalJson({ kind: "line", sceneId: "start", lineId: "l1" }),
    canonicalJson({ kind: "line", sceneId: "start", lineId: "l2" }),
  ]);
  assert.notEqual(current.hash, prior.hash);
});

test("detects new matching membership beyond an unchanged returned page", async () => {
  // Given an added match after the existing first-page hit.
  const source = await selectionSource();
  const before = await searchContext(source, args);
  assert.equal(before.kind, "ready");
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene,
      lines: [
        ...scene.lines,
        { id: "l4", speaker: null, text: "New caf\u00e9" },
      ],
    } : scene),
  });
  // When the first page is selected from the changed snapshot.
  const result = await searchContext({
    ...source, script,
    candidateRef: candidateRefSchema.parse({
      ...source.candidateRef, revision: 5,
    }),
  }, args);
  // Then complete scoped membership changes even though the returned hit does not.
  assert.equal(result.kind, "ready");
  const prior = before.readSet.find(dependency => dependency.kind === "query");
  const current = result.readSet.find(dependency => dependency.kind === "query");
  assert.ok(prior);
  assert.ok(current);
  assert.deepEqual(result.hits, before.hits);
  assert.deepEqual(current.resultIds, [
    canonicalJson({ kind: "line", sceneId: "start", lineId: "l1" }),
    canonicalJson({ kind: "line", sceneId: "start", lineId: "l2" }),
    canonicalJson({ kind: "line", sceneId: "start", lineId: "l4" }),
  ]);
  assert.notEqual(current.hash, prior.hash);
});

test("does not import sibling-scene changes into a scoped query dependency", async () => {
  // Given a changed matching line with the same ID in a different scene.
  const source = await selectionSource();
  const before = await searchContext(source, args);
  assert.equal(before.kind, "ready");
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "other" ? {
      ...scene,
      lines: scene.lines.map(line =>
        line.id === "l1" ? { ...line, text: "Different caf\u00e9" } : line),
    } : scene),
  });
  // When the original scene-scoped query is repeated.
  const result = await searchContext({
    ...source, script,
    candidateRef: candidateRefSchema.parse({
      ...source.candidateRef, revision: 5,
    }),
  }, args);
  // Then sibling content and authority revision do not change its read dependencies.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.hits, before.hits);
  assert.deepEqual(result.readSet, before.readSet);
});

test("keeps query content identity separate from candidate authority", async () => {
  // Given identical content under a later candidate revision.
  const source = await selectionSource();
  const before = await searchContext(source, args);
  assert.equal(before.kind, "ready");
  const changed = {
    ...source,
    candidateRef: candidateRefSchema.parse({
      ...source.candidateRef, revision: 5,
    }),
  };
  // When a fresh query is made without reusing an old cursor.
  const result = await searchContext(changed, args);
  // Then content dependencies remain unchanged despite different cursor authority.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.readSet, before.readSet);
});
