import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { assertNever, projectHeadSchema } from "../src/primitives.js";
import { productionDocumentSchema } from "../src/production-contracts.js";
import { assembleReuseListPatches } from "../src/reuse-assembly.js";
import type { ReuseListAssemblyResult } from "../src/reuse-assembly.js";
import { resolutionSchema } from "../src/reuse-contracts.js";
import { assembleResolvedReuseListPatches } from "../src/reuse-resolutions.js";
import type { ResolvedReuseListAssemblyResult } from "../src/reuse-resolutions.js";
import { scriptSchema } from "../src/script-contracts.js";
import { choiceResolutionFixture } from "./reuse-choice-resolution-fixture.js";

for (const mode of ["preserved", "explicit-copy", "selected-fields"] as const) {
  test(`rejects removed and unregistered retained choice destinations: ${mode}`, async () => {
    // Given an originally valid artifact whose destination is now absent from script and outline.
    const fixture = await choiceResolutionFixture();
    const script = scriptSchema.parse({
      ...fixture.base.script,
      scenes: fixture.base.script.scenes.filter(scene => scene.id !== "end").map(scene =>
        mode === "preserved" && scene.id === "start" ? { ...scene, choices: [fixture.currentChoice] } : scene),
    });
    assert.equal(fixture.base.productionDocument.outline.scenes.some(scene => scene.id === "end"), false);
    const base = { ...fixture.base, script };
    const newBaseHead = projectHeadSchema.parse({
      ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
    });
    const original = canonicalJson(base);
    // When the saved result is assembled, without rewriting its next destination.
    let result: ReuseListAssemblyResult | ResolvedReuseListAssemblyResult;
    switch (mode) {
      case "preserved":
        result = await assembleReuseListPatches({ base, newBaseHead, patches: [fixture.insertSelection] });
        break;
      case "explicit-copy":
        result = await assembleResolvedReuseListPatches({
          base, newBaseHead, patches: [fixture.insertSelection], resolutions: [fixture.copyResolution],
        });
        break;
      case "selected-fields":
        result = await assembleResolvedReuseListPatches({
          base, newBaseHead, patches: [fixture.updateSelection], resolutions: [resolutionSchema.parse({
            kind: "use-candidate-fields", operationId: fixture.updateOperationId,
            target: { kind: "choice", sceneId: "start", choiceId: "c-a" },
            expectedCurrentEntityHash: fixture.currentChoiceHash, fields: ["text"],
          })],
        });
        break;
      default: return assertNever(mode);
    }
    // Then no candidate, reuse receipt or fresh allocation can escape an invalid destination.
    assert.deepEqual(result, { kind: "blocked", reason: "INVALID_OPERATION" });
    assert.equal(canonicalJson(base), original);
  });
}

test("retained choices may still target a declared outline scene absent from the current script", async () => {
  // Given the old destination is now planned-only rather than unregistered.
  const fixture = await choiceResolutionFixture();
  const script = scriptSchema.parse({
    ...fixture.base.script,
    scenes: fixture.base.script.scenes.filter(scene => scene.id !== "end").map(scene =>
      scene.id === "start" ? { ...scene, choices: [fixture.currentChoice] } : scene),
  });
  const productionDocument = productionDocumentSchema.parse({
    ...fixture.base.productionDocument, outline: {
      ...fixture.base.productionDocument.outline, scenes: [{
        id: "end", chapter: "Later", title: "Planned destination", summary: "Continuation",
        artDirection: "Existing direction", targetMinutes: 1, background: "title", ending: "End",
      }],
    },
  });
  const base = { ...fixture.base, script, productionDocument };
  const newBaseHead = projectHeadSchema.parse({
    ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
    productionHash: await canonicalHash(productionDocument),
  });
  // When destination existence is checked with the shared script-or-outline rule.
  const result = await assembleReuseListPatches({ base, newBaseHead, patches: [fixture.insertSelection] });
  // Then a valid planned boundary is not rejected as though every destination must be materialized.
  assert.equal(result.kind, "ready");
  assert.equal(result.candidate.script.scenes.some(scene => scene.id === "end"), false);
  assert.equal(result.candidate.script.scenes.find(scene => scene.id === "start")?.choices?.length, 3);
});

test("choice destination validation does not impose a DAG restriction on existing script cycles", async () => {
  // Given an existing destination leads back to the source scene.
  const fixture = await choiceResolutionFixture();
  const script = scriptSchema.parse({
    ...fixture.base.script, scenes: fixture.base.script.scenes.map(scene => {
      if (scene.id === "start") return { ...scene, choices: [fixture.currentChoice] };
      if (scene.id !== "end") return scene;
      const { ending: _removed, ...metadata } = scene;
      return { ...metadata, next: "start" };
    }),
  });
  const base = { ...fixture.base, script };
  const newBaseHead = projectHeadSchema.parse({ ...fixture.newBaseHead, scriptHash: await canonicalHash(script) });
  // When the preserved choice batch is assembled against that valid destination set.
  const result = await assembleReuseListPatches({ base, newBaseHead, patches: [fixture.insertSelection] });
  // Then destination membership is enforced without inventing an existing-story cycle ban.
  assert.equal(result.kind, "ready");
  assert.equal(result.candidate.script.scenes.find(scene => scene.id === "end")?.next, "start");
});
