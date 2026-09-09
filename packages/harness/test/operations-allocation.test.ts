import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, parseToolEnvelope } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { journalFixture, seededInsertion } from "./operations-journal-fixture.js";

const ownershipConflicts = [
  {
    name: "another scene",
    tool: "patch_lines",
    arguments: { sceneId: "end", operations: [{
      kind: "insert", gap: { leftId: "l-a", rightId: null },
      lines: [{ clientKey: "owned-key", value: { speaker: null, text: "Changed value" } }],
    }] },
  },
  {
    name: "another entity kind",
    tool: "patch_choices",
    arguments: { sceneId: "start", operations: [{
      kind: "insert", gap: { leftId: "c-a", rightId: null },
      choices: [{ clientKey: "owned-key", value: { text: "Choice value", next: "end" } }],
    }] },
  },
] as const;

for (const scenario of ownershipConflicts) {
  test(`rejects client-key reuse when the same unit targets ${scenario.name}`, async () => {
    // Given
    const f = await seededInsertion();
    const envelope = parseToolEnvelope({
      ...f.common, callId: "00000000-0000-4000-8000-000000000002",
      expectedCandidateRevision: f.first.candidate.ref.revision,
      tool: scenario.tool, arguments: scenario.arguments,
    });

    // When
    const outcome = await applyCandidateTool({
      ...f.input, candidate: f.first.candidate, journal: f.first.journal, envelope,
    });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "ID_PAYLOAD_CONFLICT");
    assert.deepEqual(outcome.candidate, f.first.candidate);
    assert.deepEqual(outcome.journal.allocations, f.first.journal.allocations);
  });
}

test("retains allocation ownership when the allocated line was deleted", async () => {
  // Given
  const f = await seededInsertion();
  const line = f.first.candidate.script.scenes[0]?.lines[1];
  assert.ok(line);
  const deleted = await applyCandidateTool({
    ...f.input, candidate: f.first.candidate, journal: f.first.journal,
    envelope: parseToolEnvelope({
      ...f.common, callId: "00000000-0000-4000-8000-000000000002",
      expectedCandidateRevision: f.first.candidate.ref.revision, tool: "patch_lines",
      arguments: { sceneId: "start", operations: [{
        kind: "delete", lineId: line.id, expectedEntityHash: await canonicalHash(line),
      }] },
    }),
  });
  assert.equal(deleted.result.ok, true);
  const envelope = parseToolEnvelope({
    ...f.common, callId: "00000000-0000-4000-8000-000000000003",
    expectedCandidateRevision: deleted.candidate.ref.revision, tool: "patch_lines",
    arguments: { sceneId: "start", operations: [{
      kind: "insert", gap: { leftId: "l-a", rightId: null },
      lines: [{ ...f.entry, value: { speaker: null, text: "Changed after deletion" } }],
    }] },
  });

  // When
  const outcome = await applyCandidateTool({
    ...f.input, candidate: deleted.candidate, journal: deleted.journal, envelope,
  });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "ID_PAYLOAD_CONFLICT");
  assert.deepEqual(outcome.candidate, deleted.candidate);
  assert.deepEqual(outcome.journal.allocations, deleted.journal.allocations);
});

test("allows a fresh allocation when a previous batch rolled back before publication", async () => {
  // Given
  const f = await journalFixture();
  assert.equal(f.envelope.tool, "patch_lines");
  const failed = await applyCandidateTool({
    ...f.input,
    envelope: parseToolEnvelope({
      ...f.envelope,
      arguments: { sceneId: "start", operations: [
        ...f.envelope.arguments.operations,
        { kind: "delete", lineId: "missing", expectedEntityHash: "b".repeat(64) },
      ] },
    }),
  });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.result.code, "STALE_TARGET");
  const envelope = parseToolEnvelope({
    ...f.common, callId: "00000000-0000-4000-8000-000000000002", tool: "patch_lines",
    arguments: { sceneId: "start", operations: [{
      kind: "insert", gap: { leftId: "l-a", rightId: null },
      lines: [{ ...f.entry, value: { speaker: null, text: "Valid later allocation" } }],
    }] },
  });

  // When
  const outcome = await applyCandidateTool({
    ...f.input, candidate: failed.candidate, journal: failed.journal, envelope,
  });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.candidate.script.scenes[0]?.lines[1]?.text, "Valid later allocation");
  assert.deepEqual(failed.journal.allocations, []);
  assert.deepEqual(failed.candidate, f.input.candidate);
});
