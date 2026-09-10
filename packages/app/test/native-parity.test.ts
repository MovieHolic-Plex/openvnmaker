import assert from "node:assert/strict";
import test from "node:test";
import { parseScript, type VnScript } from "@vnmaker/content";
import {
  NATIVE_PARITY_FIELDS, nativeApplySpriteKey, nativeCgUrl, nativeExportBlocks, nativeParityMatrix,
  nativeTransition, VN_WAIT_READY_LINE,
} from "../src/studio/nativeParity.js";
import { RENPY_DIRECTION_RUNTIME, generateRenpyScript } from "../src/studio/renpyScript.js";
import { arithmeticStory } from "./fixtures/arithmetic-story.js";

const PRIVATE = "PRIVATE_CANARY_TOKEN_DO_NOT_RELEASE";

function story(overrides: Partial<VnScript> = {}): VnScript {
  return parseScript({
    title: "Parity", subtitle: "", start: "start", characters: [],
    scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Hi" }], ending: "End" }],
    ...overrides,
  });
}

test("parity-matrix-lists-every-required-field", () => {
  const matrix = nativeParityMatrix(story());
  assert.deepEqual(matrix.map(row => row.field), [...NATIVE_PARITY_FIELDS]);
  assert.equal(NATIVE_PARITY_FIELDS.length, 13);
  for (const row of matrix) assert.notEqual(row.status, "unsupported");
});

test("true-alpha-never-applies-legacy-character-key", () => {
  assert.equal(nativeApplySpriteKey("alpha", "#00ff00"), false);
  assert.equal(nativeApplySpriteKey("opaque", "#00ff00"), false);
  assert.equal(nativeApplySpriteKey("legacy-chroma-key", "#00ff00"), true);
  assert.equal(nativeApplySpriteKey(undefined, "#00ff00"), true);
  assert.equal(nativeApplySpriteKey("alpha", undefined), false);
  assert.match(RENPY_DIRECTION_RUNTIME, /compositing in \("alpha", "opaque"\)/);
  assert.match(RENPY_DIRECTION_RUNTIME, /vn_portrait/);
  assert.doesNotMatch(RENPY_DIRECTION_RUNTIME, /shader="vnmaker.green_key"\) if actor.get\("chromaKey"\)/);
});

test("cg-hide-and-scene-cg-id-are-converted", () => {
  const script = story({
    characters: [{ id: "a", name: "A", bio: "", color: "#ffffff" }],
    assets: [{ id: "cg-1", name: "Event", kind: "cg", url: "/assets/art/event.png", compositing: "opaque" }],
    scenes: [{
      id: "start", background: "title", cg: "cg-1",
      lines: [
        { speaker: null, text: "shown" },
        { speaker: null, text: "hidden", cgHide: true },
      ],
      ending: "End",
    }],
  });
  assert.equal(nativeCgUrl(script.scenes[0]!, script.assets), "/assets/art/event.png");
  const generated = generateRenpyScript(script);
  assert.ok(generated.includes("cg-1"));
  assert.ok(generated.includes("cgHide"));
  assert.match(RENPY_DIRECTION_RUNTIME, /vn_scene_cg/);
  assert.match(RENPY_DIRECTION_RUNTIME, /cgHide/);
  assert.deepEqual(nativeExportBlocks(story({
    scenes: [{ id: "start", background: "title", cg: "missing", lines: [{ speaker: null, text: "x" }], ending: "End" }],
  })).map(block => block.code), ["unresolved-cg"]);
  assert.throws(() => generateRenpyScript(story({
    scenes: [{ id: "start", background: "title", cg: "missing", lines: [{ speaker: null, text: "x" }], ending: "End" }],
  })), /CG/);
});

test("fades-are-exhaustive-and-fadeToBlack-is-not-silent-fade", () => {
  assert.equal(nativeTransition("none"), null);
  assert.equal(nativeTransition("fade"), "fade");
  assert.equal(nativeTransition("dissolve"), "dissolve");
  assert.match(nativeTransition("flash") ?? "", /Fade\(0\.1/);
  assert.equal(nativeTransition("fadeToBlack"), "Fade(0.5, 0.2, 0.5, color='#000000')");
  const generated = generateRenpyScript(story({
    scenes: [{ id: "start", background: "title", transition: "fadeToBlack", lines: [{ speaker: null, text: "Hi" }], ending: "End" }],
  }));
  assert.match(generated, /with Fade\(0\.5, 0\.2, 0\.5, color='#000000'\)/);
});

test("unsupported-choice-cond-is-never-dropped", () => {
  const blocked: VnScript = {
    ...arithmeticStory,
    scenes: arithmeticStory.scenes.map((scene, index) => index ? scene : {
      ...scene,
      choices: [{ text: "조건", next: "cost", cond: "trust>1" }],
    }),
  };
  assert.equal(nativeParityMatrix(blocked).find(row => row.field === "conditions")?.status, "unsupported");
  assert.throws(() => generateRenpyScript(blocked), /cond/);
});

test("public-projection-and-compositing-reach-native-manuscript", () => {
  const generated = generateRenpyScript(story({
    artDirection: PRIVATE,
    characters: [{ id: "a", name: "A", bio: "", color: "#ffffff", chromaKey: "#00ff00", expressionImages: { neutral: "/assets/art/a.png" } }],
    assets: [{ id: "a-n", name: "A", kind: "character", url: "/assets/art/a.png", compositing: "alpha", prompt: PRIVATE }],
    scenes: [{
      id: "start", background: "title", artBrief: PRIVATE,
      sprites: [{ slot: "center", character: "a" }],
      lines: [{ speaker: "a", text: "Hi" }], ending: "End",
    }],
  }));
  assert.ok(generated.includes("compositing"));
  assert.ok(generated.includes("alpha"));
  assert.equal(generated.includes(PRIVATE), false);
});

test("interaction-ready-signal-is-not-a-timed-pause", () => {
  assert.equal(VN_WAIT_READY_LINE.includes("pause"), false);
  assert.match(VN_WAIT_READY_LINE, /vn_wait_ready/);
  assert.match(RENPY_DIRECTION_RUNTIME, /def vn_wait_ready/);
  assert.match(RENPY_DIRECTION_RUNTIME, /ongoing_transition/);
  assert.doesNotMatch(RENPY_DIRECTION_RUNTIME, /pause \.3/);
});
