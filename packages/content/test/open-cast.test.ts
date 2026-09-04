import assert from "node:assert/strict";
import { test } from "node:test";
import { findManifestViolations } from "../src/check.js";
import type { VnScript } from "../src/schema.js";

/**
 * Open-cast probe: 4th heroine "yuna" + new expression "blush" + otaku
 * optional fields (cg / cgHide / cond / set / disable / flags / outfits)
 * + protagonist "me" as an ordinary character entry (no magic handling).
 * Old closed schema/checker FAILs this file (type errors + violations);
 * the opened schema/checker must keep it GREEN.
 */
const probe: VnScript = {
  title: "open cast probe",
  subtitle: "fourth heroine",
  start: "op-01",
  flags: { met_yuna: true, likes_music: 1, route: "yuna" },
  characters: [
    { id: "yuna", name: "Yuna", color: "#ff7ad9", bio: "fourth heroine", outfits: ["summer", "stage"] },
    { id: "me", name: "Protagonist", color: "#9adcff", bio: "ordinary entry, no magic", outfits: ["summer"] },
  ],
  scenes: [
    {
      id: "op-01",
      background: "campus-gate",
      cg: "yuna-first-meet",
      sprites: [
        { slot: "left", character: "yuna", expression: "blush" },
        { slot: "offstage", character: null },
      ],
      lines: [
        { speaker: "yuna", text: "hello", expression: "blush" },
        { speaker: "yuna", text: "this line hides the cg", cgHide: true },
        { speaker: "me", text: "i am just another entry" },
        { speaker: null, text: "narration" },
      ],
      choices: [
        {
          text: "go with yuna",
          next: "op-02",
          cond: "met_yuna",
          set: { met_yuna: true, yuna_affection: 1 },
          disable: false,
        },
      ],
    },
    {
      id: "op-02",
      background: "campus-gate",
      lines: [{ speaker: null, text: "ending" }],
      ending: "Yuna ending",
    },
  ],
};

test("open cast passes the manifest checker (4th heroine + new expression)", () => {
  assert.deepEqual(findManifestViolations(probe), []);
});

test("otaku optional fields are accepted on the probe script", () => {
  const first = probe.scenes[0];
  assert.ok(first);
  assert.equal(first.cg, "yuna-first-meet");
  const hideLine = first.lines[1];
  assert.ok(hideLine);
  assert.equal(hideLine.cgHide, true);
  const choice = first.choices?.[0];
  assert.ok(choice);
  assert.equal(choice.cond, "met_yuna");
  assert.deepEqual(choice.set, { met_yuna: true, yuna_affection: 1 });
  assert.equal(choice.disable, false);
  const yuna = probe.characters.find((c) => c.id === "yuna");
  assert.ok(yuna);
  assert.deepEqual(yuna.outfits, ["summer", "stage"]);
  assert.deepEqual(probe.flags, { met_yuna: true, likes_music: 1, route: "yuna" });
});

test("non-slug ids are still rejected", () => {
  const bad: VnScript = {
    ...probe,
    scenes: [
      {
        id: "bad-01",
        background: "campus-gate",
        lines: [{ speaker: "Yuna!!", text: "bad id", expression: "Blush!!" }],
        next: "bad-01",
      },
    ],
  };
  assert.equal(findManifestViolations(bad).length, 2);
});
