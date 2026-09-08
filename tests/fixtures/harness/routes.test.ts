import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNever } from "@vnmaker/harness";
import { generateMedium } from "./medium.js";
import { routeOracle } from "./oracle.js";
import { assertInventory, assertRoute } from "./verify.js";

for (const route of routeOracle()) test(`matches route ${route.id} when playing the real reducer`, () => {
  // Given
  const script = generateMedium();
  // When / Then
  assertRoute(script, route);
});
test("matches history when advancing each line rather than skipping scenes", () => {
  // Given
  const route = routeOracle()[0];
  assert.ok(route);
  // When / Then
  assertRoute(generateMedium(), route, "advance");
});
test("checks all asset payloads when validating the medium inventory", async () => {
  // Given
  const script = generateMedium();
  // When
  const result = await assertInventory(script);
  // Then
  assert.equal(result.inventory.length, 140);
});
for (const mutation of ["ending", "flags", "history", "inventory"] as const) test(`rejects ${mutation} when its actual fixture data is corrupted`, async () => {
  // Given
  const script = generateMedium();
  const route = routeOracle()[0];
  assert.ok(route);
  const changed = { ...script, scenes: script.scenes.map(scene => scene.id === "s078" && mutation === "ending"
    ? { ...scene, ending: "wrong-ending" } : scene.id === "s001" && mutation === "history"
      ? { ...scene, lines: scene.lines.slice(1) } : scene),
    ...(mutation === "flags" ? { flags: { ...script.flags, score: 1 } } : {}),
    ...(mutation === "inventory" ? { assets: script.assets?.slice(1) ?? [] } : {}) };
  // When / Then
  switch (mutation) {
    case "ending": assert.throws(() => assertRoute(changed, route), { message: /ROUTE_ENDING:000/ }); break;
    case "flags": assert.throws(() => assertRoute(changed, route), { message: /ROUTE_FLAGS:000/ }); break;
    case "history": assert.throws(() => assertRoute(changed, route), { message: /ROUTE_HISTORY:000/ }); break;
    case "inventory": await assert.rejects(assertInventory(changed), { message: /MEDIUM_EXACT_COUNTS/ }); break;
    default: assertNever(mutation);
  }
});
test("rejects an extra route when an unselected choice is introduced", () => {
  // Given
  const script = generateMedium();
  const route = routeOracle()[0];
  assert.ok(route);
  const changed = { ...script, scenes: script.scenes.map(scene => scene.id === "s020"
    ? { ...scene, choices: [...(scene.choices ?? []), { id: "extra", text: "Synthetic extra route", next: "s021" }] } : scene) };
  // When / Then
  assert.throws(() => assertRoute(changed, route), { message: /ROUTE_MENU:000/ });
});
