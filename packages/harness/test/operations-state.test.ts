import assert from "node:assert/strict";
import test from "node:test";
import { parseToolEnvelope } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectFixture } from "./operations-project-fixture.js";

test("applies an initial-state batch when every precondition matches", async () => {
  // Given
  const f = await projectFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_state",
    arguments: {
      expectedStateHash: f.stateHash,
      declare: [{ id: "added", value: "new" }],
      setInitial: [{ id: "coins", expectedValue: 1, value: 2 }],
      remove: [{ id: "spare", expectedValue: false }],
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  assert.deepEqual(outcome.candidate.script, {
    ...before.script, flags: { ready: true, coins: 2, added: "new" },
  });
  assert.deepEqual(outcome.candidate.productionDocument, before.productionDocument);
  assert.deepEqual(f.input.candidate, before);
});

test("keeps the revision when initial-state values are unchanged", async () => {
  // Given
  const f = await projectFixture();
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_state",
    arguments: {
      expectedStateHash: f.stateHash, declare: [], remove: [],
      setInitial: [{ id: "coins", expectedValue: 1, value: 1 }],
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rolls back declarations when a later initial value is stale", async () => {
  // Given
  const f = await projectFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_state",
    arguments: {
      expectedStateHash: f.stateHash,
      declare: [{ id: "added", value: "must not survive" }],
      setInitial: [{ id: "coins", expectedValue: 99, value: 2 }],
      remove: [],
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

const referencedFlags = [
  { id: "ready", expectedValue: true, source: "line condition" },
  { id: "coins", expectedValue: 1, source: "choice effect" },
] as const;

for (const flag of referencedFlags) {
  test(`rejects state removal when a ${flag.source} still references it`, async () => {
    // Given
    const f = await projectFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "patch_state",
      arguments: {
        expectedStateHash: f.stateHash, declare: [], setInitial: [],
        remove: [{ id: flag.id, expectedValue: flag.expectedValue }],
      },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "REFERENCED_ENTITY");
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
  });
}

const failures = [
  { name: "state hash is stale", authorized: true, stale: true, code: "STALE_TARGET" },
  { name: "state scope is absent", authorized: false, stale: false, code: "WRITE_SCOPE_DENIED" },
] as const;

for (const scenario of failures) {
  test(`rejects initial-state mutation when ${scenario.name}`, async () => {
    // Given
    const f = await projectFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "patch_state",
      arguments: {
        expectedStateHash: scenario.stale ? "b".repeat(64) : f.stateHash,
        declare: [{ id: "added", value: true }], setInitial: [], remove: [],
      },
    });

    // When
    const outcome = await applyCandidateTool({
      ...f.input, envelope,
      authorizedWriteSet: scenario.authorized ? f.input.authorizedWriteSet : [],
    });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, scenario.code);
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
  });
}
