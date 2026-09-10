import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical.js";
import { choiceIdForClientKey } from "../src/operations-list.js";
import { sceneIdSchema } from "../src/primitives.js";
import { resolutionSchema } from "../src/reuse-contracts.js";
import { assembleResolvedReuseListPatches } from "../src/reuse-resolutions.js";
import { choiceResolutionFixture } from "./reuse-choice-resolution-fixture.js";

test("choice field selection preserves unselected route effects and current disable state", async () => {
  // Given a candidate text/effect change and a newer disabled source choice.
  const fixture = await choiceResolutionFixture();
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.updateOperationId,
    target: { kind: "choice", sceneId: "start", choiceId: "c-a" },
    expectedCurrentEntityHash: fixture.currentChoiceHash, fields: ["text"],
  });
  // When the author chooses text but not the generated route-state changes.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.updateSelection], resolutions: [resolution],
  });
  // Then existing add effects, next target and disabled state remain source-owned.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start")?.choices, [
    { ...fixture.currentChoice, text: fixture.proposedText }, ...fixture.insertedChoices,
  ]);
});

test("choice resolution rejects incompatible set/add rather than removing an unselected source effect", async () => {
  // Given selecting set alone leaves a conflicting source add for the same flag.
  const fixture = await choiceResolutionFixture();
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.updateOperationId,
    target: { kind: "choice", sceneId: "start", choiceId: "c-a" },
    expectedCurrentEntityHash: fixture.currentChoiceHash, fields: ["set"],
  });
  const original = canonicalJson(fixture.base);
  // When that incomplete effect replacement is requested.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.updateSelection], resolutions: [resolution],
  });
  // Then existing choice validation rejects it without silently widening the field selection.
  assert.deepEqual(result, { kind: "blocked", reason: "INVALID_OPERATION" });
  assert.equal(canonicalJson(fixture.base), original);
});

test("choice resolution accepts the explicitly selected compatible set/add replacement", async () => {
  // Given both the generated set and proposed add removal are explicitly selected.
  const fixture = await choiceResolutionFixture();
  const { add: _removed, ...sourceChoice } = fixture.currentChoice;
  const resolution = resolutionSchema.parse({
    kind: "use-candidate-fields", operationId: fixture.updateOperationId,
    target: { kind: "choice", sceneId: "start", choiceId: "c-a" },
    expectedCurrentEntityHash: fixture.currentChoiceHash, fields: ["set", "add"],
  });
  // When the complete compatible effect replacement is assembled.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.updateSelection], resolutions: [resolution],
  });
  // Then the effect changes but unselected candidate text is not imported.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start")?.choices, [
    { ...sourceChoice, set: fixture.proposedSet }, ...fixture.insertedChoices,
  ]);
});

test("copies the complete choice insertion group with the fresh candidate allocation namespace", async () => {
  // Given a single insertion artifact containing two distinct preserved choices.
  const fixture = await choiceResolutionFixture();
  const expectedIds = await Promise.all([0, 1].map(index => choiceIdForClientKey({
    candidateId: fixture.base.ref.candidateId, unitId: fixture.unitId,
    sceneId: sceneIdSchema.parse("start"), clientKey: `route-copy:${index}`,
  })));
  const original = canonicalJson(fixture.base);
  // When that whole insertion group is explicitly copied at its selected terminal gap.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.insertSelection], resolutions: [fixture.copyResolution],
  });
  // Then neither a single arbitrary entry nor an old namespace can satisfy the result.
  assert.equal(result.kind, "ready");
  const choices = result.candidate.script.scenes.find(scene => scene.id === "start")?.choices;
  assert.ok(choices);
  assert.equal(choices.length, 5);
  assert.deepEqual(choices.slice(0, 3), [fixture.currentChoice, ...fixture.insertedChoices]);
  assert.deepEqual(choices.slice(3).map(choice => choice.id), expectedIds);
  assert.deepEqual(choices.slice(3).map(({ id: _id, ...value }) => value),
    fixture.insertedChoices.map(({ id: _id, ...value }) => value));
  assert.equal(result.allocations.length, 2);
  assert.deepEqual(result.allocations.map(row => row.target), expectedIds.map(choiceId => ({
    kind: "choice", sceneId: "start", choiceId,
  })));
  assert.equal(canonicalJson(fixture.base), original);
});

test("a later stale choice patch discards an earlier resolved copy and its allocations", async () => {
  // Given the explicit copy can succeed, but the later original choice hash is stale.
  const fixture = await choiceResolutionFixture();
  const original = canonicalJson(fixture.base);
  const artifacts = canonicalJson([fixture.insertSelection.artifact, fixture.updateSelection.artifact]);
  // When the copy and dependent historical update are assembled in their original order.
  const result = await assembleResolvedReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.insertSelection, fixture.updateSelection],
    resolutions: [fixture.copyResolution],
  });
  // Then failure publishes no partial candidate, receipt or fresh-ID allocation.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
  assert.equal(canonicalJson(fixture.base), original);
  assert.equal(canonicalJson([fixture.insertSelection.artifact, fixture.updateSelection.artifact]), artifacts);
});
