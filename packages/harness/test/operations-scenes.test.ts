import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, lineIdSchema, parseToolEnvelope } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { sceneFixture } from "./operations-scene-fixture.js";

test("creates a scene when its approved outline beat and scope match", async () => {
  // Given
  const f = await sceneFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "create_scene", arguments: f.creation,
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  assert.deepEqual(outcome.candidate.script.scenes.slice(0, 3), before.script.scenes);
  const created = outcome.candidate.script.scenes[3];
  assert.ok(created);
  assert.equal(created.id, "future");
  assert.equal(created.ending, "Future end");
  assert.equal(created.lines.length, 1);
  lineIdSchema.parse(created.lines[0]?.id);
  assert.notEqual(created.lines[0]?.id, "draft-line");
  assert.equal(created.lines[0]?.text, "New scene");
  assert.deepEqual(outcome.candidate.productionDocument, before.productionDocument);
  assert.deepEqual(f.input.candidate, before);
});

const creationFailures = [
  { sceneId: "rogue", planBeatId: "future", code: "INVALID_OPERATION" },
  { sceneId: "future", planBeatId: "missing-beat", code: "INVALID_OPERATION" },
  { sceneId: "start", planBeatId: "start", code: "ID_PAYLOAD_CONFLICT" },
] as const;

for (const scenario of creationFailures) {
  test(`rejects scene creation when ${scenario.sceneId}/${scenario.planBeatId} is invalid`, async () => {
    // Given
    const f = await sceneFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "create_scene",
      arguments: { ...f.creation, sceneId: scenario.sceneId, planBeatId: scenario.planBeatId },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, scenario.code);
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
  });
}

test("deletes a scene when it is unreferenced and its hash matches", async () => {
  // Given
  const f = await sceneFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "delete_scene",
    arguments: { sceneId: "spare", expectedSceneHash: await canonicalHash(f.spare) },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  assert.deepEqual(outcome.candidate.script, {
    ...before.script, scenes: before.script.scenes.filter(scene => scene.id !== "spare"),
  });
  assert.deepEqual(f.input.candidate, before);
});

const deletionFailures = [
  { sceneId: "start", stale: false, code: "REFERENCED_ENTITY" },
  { sceneId: "end", stale: false, code: "REFERENCED_ENTITY" },
  { sceneId: "missing", stale: false, code: "STALE_TARGET" },
  { sceneId: "spare", stale: true, code: "STALE_TARGET" },
] as const;

for (const scenario of deletionFailures) {
  test(`rejects deletion of ${scenario.sceneId} when its removal precondition fails`, async () => {
    // Given
    const f = await sceneFixture();
    const before = structuredClone(f.input.candidate);
    const scene = before.script.scenes.find(row => row.id === scenario.sceneId);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "delete_scene",
      arguments: {
        sceneId: scenario.sceneId,
        expectedSceneHash: scene && !scenario.stale ? await canonicalHash(scene) : "b".repeat(64),
      },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, scenario.code);
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
  });
}
