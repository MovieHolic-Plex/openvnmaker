import assert from "node:assert/strict";
import { test } from "node:test";
import { scriptSchema, sceneSchema } from "@vnmaker/harness";
import { reduce } from "../../../packages/app/src/engine/reducer.js";
import { initialState } from "../../../packages/app/src/engine/types.js";

test("preserves scoped identity when two scenes reuse a line ID", () => {
  // Given
  const scenes = ["a", "b"].map(id => sceneSchema.parse({ id, background: "title",
    lines: [{ id: "shared", speaker: null, text: id }], ending: id }));
  // When
  const parsed = scriptSchema.parse({ title: "Synthetic baseline", subtitle: "", start: "a", characters: [], scenes });
  // Then
  assert.deepEqual(parsed.scenes.map(scene => scene.lines[0]?.id), ["shared", "shared"]);
});

test("records the last line once when skipping into an ending", () => {
  // Given
  const script = scriptSchema.parse({ title: "Synthetic baseline", subtitle: "", start: "a", characters: [],
    scenes: [{ id: "a", background: "title", lines: [{ id: "last", speaker: null, text: "synthetic" }], ending: "end-a" }] });
  // When
  const result = reduce(script, reduce(script, initialState(script), { type: "start" }), { type: "skipScene" });
  // Then
  assert.deepEqual({ phase: result.phase, ending: result.endingTitle, history: result.history.length }, { phase: "ending", ending: "end-a", history: 1 });
});
