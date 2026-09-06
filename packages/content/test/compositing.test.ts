import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript } from "../src/parse.js";

const legacy = {
  title: "Legacy", subtitle: "", start: "start", characters: [],
  scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Hello" }], ending: "End" }],
  assets: [{ id: "art", name: "Art", kind: "background", url: "/assets/bg/black.png" }],
};

test("preserves legacy artwork identity when compositing is absent", () => {
  // Given
  const input = structuredClone(legacy);
  // When
  const parsed = parseScript(input);
  // Then
  assert.strictEqual(parsed, input);
  assert.deepEqual(parsed, legacy);
  assert.equal(Object.hasOwn(parsed.assets?.[0] ?? {}, "compositing"), false);
});

test("rejects artwork when compositing is unsupported", () => {
  // Given
  const input = { ...legacy, assets: legacy.assets.map(asset => ({ ...asset, compositing: "unsupported-mode" })) };
  // When / Then
  assert.throws(() => parseScript(input));
});

for (const compositing of ["alpha", "legacy-chroma-key", "opaque"] as const) {
  test(`roundtrips artwork when compositing is ${compositing}`, () => {
    // Given
    const input = { ...legacy, assets: legacy.assets.map(asset => ({ ...asset, compositing })) };
    // When
    const parsed = parseScript(input);
    // Then
    assert.strictEqual(parsed, input);
    assert.deepEqual(parsed.assets, input.assets);
  });
}
