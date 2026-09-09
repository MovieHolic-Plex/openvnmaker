import assert from "node:assert/strict";
import test from "node:test";
import { candidateRefSchema, parseToolEnvelope, unitIdSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { operationJournalSchema } from "../src/operations-receipts.js";
import { seededInsertion } from "./operations-journal-fixture.js";

const foreignId = "00000000-0000-4000-8000-000000000099";

for (const variant of ["success", "failure"] as const) {
  test(`rejects imported journal data when a ${variant} receipt belongs to another candidate`, async () => {
    // Given
    const f = await seededInsertion();
    const receipt = f.first.journal.calls[0];
    assert.ok(receipt);
    assert.equal(f.first.result.ok, true);
    const foreignRef = candidateRefSchema.parse({
      ...f.first.candidate.ref, candidateId: foreignId,
    });
    const results = {
      success: { ...f.first.result, candidateRef: foreignRef },
      failure: {
        ok: false, callId: f.envelope.callId,
        code: "STALE_TARGET", message: "STALE_TARGET",
        currentCandidateRef: foreignRef, retryHint: [],
      },
    } as const;

    // When
    const parsed = operationJournalSchema.safeParse({
      ...f.first.journal, calls: [{ ...receipt, result: results[variant] }],
    });

    // Then
    assert.equal(parsed.success, false);
  });
}

test("rejects imported journal data when a call ID has duplicate receipts", async () => {
  // Given
  const f = await seededInsertion();
  const receipt = f.first.journal.calls[0];
  assert.ok(receipt);

  // When
  const parsed = operationJournalSchema.safeParse({
    ...f.first.journal, calls: [receipt, receipt],
  });

  // Then
  assert.equal(parsed.success, false);
});

test("rejects imported journal data when a unit client key has two allocation owners", async () => {
  // Given
  const f = await seededInsertion();
  const allocation = f.first.journal.allocations[0];
  assert.ok(allocation);

  // When
  const parsed = operationJournalSchema.safeParse({
    ...f.first.journal,
    allocations: [allocation, {
      ...allocation, target: { ...allocation.target, sceneId: "end" },
    }],
  });

  // Then
  assert.equal(parsed.success, false);
});

test("rejects a foreign journal when the candidate revision and fresh call are otherwise valid", async () => {
  // Given
  const f = await seededInsertion();
  const journal = operationJournalSchema.parse({
    candidateId: foreignId, calls: [], allocations: [],
  });
  const envelope = parseToolEnvelope({
    ...f.common, callId: "00000000-0000-4000-8000-000000000002",
    expectedCandidateRevision: f.first.candidate.ref.revision, tool: "patch_lines",
    arguments: { sceneId: "end", operations: [{
      kind: "insert", gap: { leftId: "l-a", rightId: null },
      lines: [{ clientKey: "foreign-attempt", value: { speaker: null, text: "Denied" } }],
    }] },
  });

  // When
  const outcome = await applyCandidateTool({
    ...f.input, candidate: f.first.candidate, journal, envelope,
  });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "STALE_HEAD");
  assert.deepEqual(outcome.candidate, f.first.candidate);
  assert.deepEqual(outcome.journal, journal);
});

test("rejects receipt reuse when another unit supplies the same envelope", async () => {
  // Given
  const f = await seededInsertion();

  // When
  const outcome = await applyCandidateTool({
    ...f.input, candidate: f.first.candidate, journal: f.first.journal,
    unitId: unitIdSchema.parse(foreignId), envelope: f.envelope,
  });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "ID_PAYLOAD_CONFLICT");
  assert.deepEqual(outcome.candidate, f.first.candidate);
  assert.deepEqual(outcome.journal, f.first.journal);
});
