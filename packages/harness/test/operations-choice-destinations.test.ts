import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, parseToolEnvelope, writeSetSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { sceneFixture } from "./operations-scene-fixture.js";

const destinations = [
  { id: "end", allowed: true },
  { id: "future", allowed: true },
  { id: "start", allowed: true },
  { id: "rogue", allowed: false },
] as const;
const positions = { insert: 1, update: 0 } as const;

for (const kind of ["insert", "update"] as const) {
  for (const destination of destinations) {
    test(`checks choice ${kind} destination ${destination.id} against actual or planned scenes`, async () => {
      // Given
      const f = await sceneFixture();
      const existing = f.scene.choices?.[0];
      assert.ok(existing);
      const before = structuredClone(f.input.candidate);
      const operations = {
        insert: {
          kind: "insert",
          gap: { leftId: "c-a", rightId: null },
          choices: [{
            clientKey: "route-new",
            value: { text: "New route", next: destination.id },
          }],
        },
        update: {
          kind: "update", choiceId: "c-a",
          expectedEntityHash: await canonicalHash(existing),
          patch: { set: { next: destination.id }, unset: [] },
        },
      };
      const envelope = parseToolEnvelope({
        ...f.common, tool: "patch_choices",
        arguments: { sceneId: "start", operations: [operations[kind]] },
      });
      const authorizedWriteSet = writeSetSchema.parse([{
        target: { kind: "scene", sceneId: "start" }, fields: ["choices"],
      }]);

      // When
      const outcome = await applyCandidateTool({ ...f.input, authorizedWriteSet, envelope });

      // Then
      if (destination.allowed) {
        assert.equal(outcome.result.ok, true);
        assert.equal(
          outcome.candidate.script.scenes[0]?.choices?.[positions[kind]]?.next,
          destination.id,
        );
        assert.deepEqual(
          outcome.candidate.script.scenes.slice(1), before.script.scenes.slice(1),
        );
      } else {
        assert.equal(outcome.result.ok, false);
        assert.equal(outcome.result.code, "INVALID_OPERATION");
        assert.deepEqual(outcome.candidate, before);
        assert.deepEqual(outcome.journal.allocations, f.input.journal.allocations);
      }
      assert.deepEqual(f.input.candidate, before);
    });
  }
}

test("rolls back earlier choice edits and allocations when a later destination is unregistered", async () => {
  // Given
  const f = await sceneFixture();
  const existing = f.scene.choices?.[0];
  assert.ok(existing);
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_choices",
    arguments: { sceneId: "start", operations: [
      {
        kind: "update", choiceId: "c-a",
        expectedEntityHash: await canonicalHash(existing),
        patch: { set: { text: "Private intermediate edit" }, unset: [] },
      },
      {
        kind: "insert", gap: { leftId: "c-a", rightId: null },
        choices: [{
          clientKey: "invalid-route",
          value: { text: "Invalid route", next: "rogue" },
        }],
      },
    ] },
  });
  const authorizedWriteSet = writeSetSchema.parse([{
    target: { kind: "scene", sceneId: "start" }, fields: ["choices"],
  }]);

  // When
  const outcome = await applyCandidateTool({ ...f.input, authorizedWriteSet, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_OPERATION");
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(outcome.journal.allocations, f.input.journal.allocations);
  assert.deepEqual(f.input.candidate, before);
});

test("uses ordered full-entity preimages when two updates affect the same choice", async () => {
  // Given
  const f = await sceneFixture();
  const existing = f.scene.choices?.[0];
  assert.ok(existing);
  const intermediate = { ...existing, text: "Intermediate value" };
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_choices",
    arguments: { sceneId: "start", operations: [
      {
        kind: "update", choiceId: "c-a",
        expectedEntityHash: await canonicalHash(existing),
        patch: { set: { text: intermediate.text }, unset: [] },
      },
      {
        kind: "update", choiceId: "c-a",
        expectedEntityHash: await canonicalHash(intermediate),
        patch: { set: { next: "future" }, unset: [] },
      },
    ] },
  });
  const authorizedWriteSet = writeSetSchema.parse([{
    target: { kind: "scene", sceneId: "start" }, fields: ["choices"],
  }]);

  // When
  const outcome = await applyCandidateTool({ ...f.input, authorizedWriteSet, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.deepEqual(
    outcome.candidate.script.scenes[0]?.choices?.[0],
    { ...intermediate, next: "future" },
  );
  assert.deepEqual(f.input.candidate, before);
});
