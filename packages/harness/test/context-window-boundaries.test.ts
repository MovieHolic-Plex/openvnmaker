import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../src/canonical.js";
import { readSceneContext, searchContext } from "../src/context.js";
import { scriptSchema } from "../src/script-contracts.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

test("returns an empty terminal window without repeating the final line", async () => {
  // Given an anchor at the final authored line.
  const source = await selectionSource();
  const args = toolArgumentsSchemas.read_scene.parse({
    sceneId: "start", afterLineId: "l3", limit: 1,
  });
  const emptyHash = await canonicalHash([]);
  // When the following window is requested.
  const result = await readSceneContext(source, args);
  // Then terminal boundaries and empty window identity are explicit.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.window, {
    sceneId: "start", lineIds: [], hash: emptyHash,
  });
  assert.equal(result.beforeLineId, "l3");
  assert.equal(result.afterLineId, null);
});

test("caps a default window at 100 original lines with an explicit omission", async () => {
  // Given 101 authored lines and no explicit limit.
  const source = await selectionSource();
  const lines = Array.from({ length: 101 }, (_, index) => ({
    id: `n${index}`, speaker: null, text: `Line ${index}`,
  }));
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene =>
      scene.id === "start" ? { ...scene, lines } : scene),
  });
  // When the default window is read.
  const result = await readSceneContext(
    { ...source, script },
    toolArgumentsSchemas.read_scene.parse({ sceneId: "start" }),
  );
  // Then exactly the bounded original passage is returned.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.lines, lines.slice(0, 100));
  assert.equal(result.beforeLineId, null);
  assert.equal(result.afterLineId, "n100");
  assert.deepEqual(result.excluded, [{
    target: { kind: "line", sceneId: "start", lineId: "n100" },
    reason: "OUTSIDE_WINDOW",
  }]);
});

test("blocks an identity-bearing window when a source line lacks an ID", async () => {
  // Given a valid legacy line without a stable identity.
  const source = await selectionSource();
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: [{ speaker: null, text: "Legacy caf\u00e9" }],
    } : scene),
  });
  // When a scoped read is requested.
  const result = await readSceneContext(
    { ...source, script },
    toolArgumentsSchemas.read_scene.parse({ sceneId: "start" }),
  );
  // Then the reader does not fabricate an ID or substitute another scene's line.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
});

test("blocks a matching legacy line rather than inventing its search identity", async () => {
  // Given a matching authored line without an ID.
  const source = await selectionSource();
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: [{ speaker: null, text: "Legacy caf\u00e9" }],
    } : scene),
  });
  // When stable search references are requested.
  const result = await searchContext(
    { ...source, script },
    toolArgumentsSchemas.search_content.parse({
      query: "caf\u00e9", kinds: ["line"], sceneId: "start",
    }),
  );
  // Then the missing identity is surfaced.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
});

test("blocks a matching legacy choice rather than inventing its search identity", async () => {
  // Given a matching authored choice without an ID.
  const source = await selectionSource();
  const script = scriptSchema.parse({
    ...source.script,
    scenes: source.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, choices: [{ text: "Caf\u00e9 door", next: "other" }],
    } : scene),
  });
  // When stable choice references are requested.
  const result = await searchContext(
    { ...source, script },
    toolArgumentsSchemas.search_content.parse({
      query: "caf\u00e9", kinds: ["choice"], sceneId: "start",
    }),
  );
  // Then the missing identity is surfaced.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
});
