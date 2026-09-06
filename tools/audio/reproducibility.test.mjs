import { test } from "node:test";
import assert from "node:assert/strict";
import { seedTrack, random } from "./random.mjs";
import { BGM, SFX } from "./tracks.mjs";
import { encodeMp3 } from "./mp3.mjs";
import { SR } from "./synth.mjs";

test("track randomness resets independently, without changing global Math.random", () => {
  const original = Math.random;
  const stream = () => Array.from({length: 100}, random);
  seedTrack(123, "sfx", "cicada"); const first = stream();
  seedTrack(123, "bgm", "rain"); stream();
  seedTrack(123, "sfx", "cicada"); assert.deepEqual(stream(), first);
  seedTrack(124, "sfx", "cicada"); assert.notDeepEqual(stream(), first);
  assert.equal(Math.random, original);
  assert.ok(first.every(value => value >= 0 && value < 1));
});

test("randomized effects reproduce encoded bytes across track order and respond to seed changes", () => {
  assert.equal(Object.keys(BGM).length, 5);
  assert.equal(Object.keys(SFX).length, 10);
  const render = seed => { seedTrack(seed, "sfx", "cicada"); return encodeMp3(SFX.cicada(), SR, 128); };
  const first = render(20260906);
  seedTrack(20260906, "sfx", "rain-loop"); SFX["rain-loop"]();
  assert.deepEqual(render(20260906), first);
  assert.notDeepEqual(render(20260907), first);
});
