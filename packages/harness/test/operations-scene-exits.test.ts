import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, choiceIdSchema, parseToolEnvelope } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { sceneFixture } from "./operations-scene-fixture.js";

test("patches scene metadata when its hash matches without replacing content", async () => {
  // Given
  const f = await sceneFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "set_scene",
    arguments: {
      sceneId: "start", expectedSceneHash: await canonicalHash(f.scene),
      patch: { set: { framing: "close" }, unset: ["artBrief"] },
    },
  });
  const expected = { ...f.scene, framing: "close" };
  Reflect.deleteProperty(expected, "artBrief");

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.deepEqual(outcome.candidate.script.scenes[0], expected);
  assert.deepEqual(outcome.candidate.script.scenes.slice(1), before.script.scenes.slice(1));
  assert.deepEqual(f.input.candidate, before);
});

const exits = [
  { exit: { kind: "next", sceneId: "end" }, fields: { next: "end" } },
  { exit: { kind: "ending", title: "Replacement ending" }, fields: { ending: "Replacement ending" } },
  { exit: { kind: "planned", sceneId: "future" }, fields: { next: "future" } },
] as const;

for (const scenario of exits) {
  test(`replaces the scene exit when a ${scenario.exit.kind} destination is valid`, async () => {
    // Given
    const f = await sceneFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "set_scene",
      arguments: {
        sceneId: "start", expectedSceneHash: await canonicalHash(f.scene),
        patch: { set: {}, unset: [] }, exit: scenario.exit,
      },
    });
    const preserved = { ...f.scene };
    for (const field of ["choices", "next", "ending"]) Reflect.deleteProperty(preserved, field);

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, true);
    assert.equal(outcome.candidate.ref.revision, 5);
    assert.deepEqual(outcome.candidate.script.scenes[0], { ...preserved, ...scenario.fields });
    assert.deepEqual(outcome.candidate.script.scenes.slice(1), before.script.scenes.slice(1));
    assert.deepEqual(f.input.candidate, before);
  });
}

test("preserves an existing scoped choice when rebuilding a choice exit", async () => {
  // Given
  const f = await sceneFixture();
  const existing = f.scene.choices?.[0];
  assert.ok(existing);
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "set_scene",
    arguments: {
      sceneId: "start", expectedSceneHash: await canonicalHash(f.scene),
      patch: { set: {}, unset: [] },
      exit: { kind: "choices", choices: [
        { kind: "existing", choiceId: "c-a", expectedEntityHash: await canonicalHash(existing) },
        { kind: "new", clientKey: "exit-choice", value: { text: "Later", next: "future" } },
      ] },
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  const choices = outcome.candidate.script.scenes[0]?.choices;
  assert.ok(choices);
  assert.equal(choices.length, 2);
  assert.deepEqual(choices[0], existing);
  choiceIdSchema.parse(choices[1]?.id);
  assert.notEqual(choices[1]?.id, "exit-choice");
  assert.notEqual(choices[1]?.id, "c-a");
  assert.equal(choices[1]?.next, "future");
  assert.deepEqual(f.input.candidate, before);
});

test("rolls back metadata when an existing choice precondition is stale", async () => {
  // Given
  const f = await sceneFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "set_scene",
    arguments: {
      sceneId: "start", expectedSceneHash: await canonicalHash(f.scene),
      patch: { set: { framing: "close" }, unset: [] },
      exit: { kind: "choices", choices: [
        { kind: "existing", choiceId: "c-a", expectedEntityHash: "b".repeat(64) },
      ] },
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "STALE_TARGET");
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});

test("rejects a planned exit when its destination is absent from the outline", async () => {
  // Given
  const f = await sceneFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "set_scene",
    arguments: {
      sceneId: "start", expectedSceneHash: await canonicalHash(f.scene),
      patch: { set: {}, unset: [] }, exit: { kind: "planned", sceneId: "rogue" },
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_OPERATION");
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});

test("rejects scene exit replacement when exit scope is absent", async () => {
  // Given
  const f = await sceneFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "set_scene",
    arguments: {
      sceneId: "start", expectedSceneHash: await canonicalHash(f.scene),
      patch: { set: {}, unset: [] }, exit: { kind: "ending", title: "Denied" },
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, authorizedWriteSet: [], envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "WRITE_SCOPE_DENIED");
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});
