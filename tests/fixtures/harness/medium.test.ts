import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalHash } from "@vnmaker/harness";
import { generateMedium } from "./medium.js";
import { routeOracle } from "./oracle.js";

test("creates exact inventory when generating the synthetic medium fixture", () => {
  // Given / When
  const script = generateMedium();
  // Then
  assert.deepEqual({ scenes: script.scenes.length, lines: script.scenes.reduce((n, s) => n + s.lines.length, 0),
    characters: script.characters.length, endings: script.scenes.filter(s => s.ending).length,
    artwork: script.assets?.length ?? 0, audio: script.audioAssets?.length ?? 0 },
  { scenes: 80, lines: 6000, characters: 8, endings: 3, artwork: 120, audio: 20 }, "MEDIUM_EXACT_COUNTS");
});
test("declares eight routes when reading the independent oracle", () => {
  // Given / When
  const routes = routeOracle();
  // Then
  assert.equal(routes.length, 8, "ORACLE_ROUTE_COUNT");
});
test("retains a deterministic hash when independently generating twice", async () => {
  // Given
  const first = await canonicalHash(generateMedium());
  // When / Then
  assert.equal(await canonicalHash(generateMedium()), first);
});
