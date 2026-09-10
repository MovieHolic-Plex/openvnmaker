import assert from "node:assert/strict";
import test from "node:test";
import { parseToolEnvelope } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { operationJournalSchema } from "../src/operations-receipts.js";
import { projectFixture } from "./operations-project-fixture.js";
import { seededInsertion } from "./operations-journal-fixture.js";

test("replays the stored result when the exact call returns after journal serialization", async () => {
  // Given
  const f = await seededInsertion();
  const journal = operationJournalSchema.parse(JSON.parse(JSON.stringify(f.first.journal)));
  const before = structuredClone(f.first.candidate);

  // When
  const replay = await applyCandidateTool({
    ...f.input, candidate: f.first.candidate, journal, envelope: f.envelope,
  });

  // Then
  assert.deepEqual(replay.result, f.first.result);
  assert.deepEqual(replay.candidate, before);
  assert.deepEqual(replay.journal, journal);
});

test("rejects changed payload when a call ID already has a receipt", async () => {
  // Given
  const f = await seededInsertion();
  const envelope = parseToolEnvelope({
    ...f.envelope,
    arguments: { sceneId: "start", operations: [{
      kind: "insert", gap: { leftId: "l-a", rightId: null },
      lines: [{ ...f.entry, value: { speaker: null, text: "Different payload" } }],
    }] },
  });

  // When
  const result = await applyCandidateTool({
    ...f.input, candidate: f.first.candidate, journal: f.first.journal, envelope,
  });

  // Then
  assert.equal(result.result.ok, false);
  assert.equal(result.result.code, "ID_PAYLOAD_CONFLICT");
  assert.deepEqual(result.candidate, f.first.candidate);
  assert.deepEqual(result.journal, f.first.journal);
});

test("checks current authorization when an exact receipt is replayed", async () => {
  // Given
  const f = await seededInsertion();

  // When
  const result = await applyCandidateTool({
    ...f.input, candidate: f.first.candidate, journal: f.first.journal,
    authorizedWriteSet: [], envelope: f.envelope,
  });

  // Then
  assert.equal(result.result.ok, false);
  assert.equal(result.result.code, "WRITE_SCOPE_DENIED");
  assert.deepEqual(result.candidate, f.first.candidate);
  assert.deepEqual(result.journal, f.first.journal);
});

test("records a no-op once when the same call is repeated", async () => {
  // Given
  const f = await projectFixture();
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_project",
    arguments: {
      expectedMetadataHash: f.metadataHash,
      patch: { set: { title: f.metadata.title }, unset: [] },
    },
  });
  const first = await applyCandidateTool({ ...f.input, envelope });
  assert.equal(first.result.ok, true);
  assert.equal(first.result.changed, false);

  // When
  const replay = await applyCandidateTool({
    ...f.input, candidate: first.candidate, journal: first.journal, envelope,
  });

  // Then
  assert.deepEqual(replay.result, first.result);
  assert.deepEqual(replay.candidate, f.input.candidate);
  assert.equal(replay.journal.calls.length, 1);
  assert.deepEqual(replay.journal.calls[0]?.result, first.result);
});

test("preserves newer candidate changes when an older successful call is replayed", async () => {
  // Given
  const f = await seededInsertion();
  const later = await applyCandidateTool({
    ...f.input, candidate: f.first.candidate, journal: f.first.journal,
    envelope: parseToolEnvelope({
      ...f.common, callId: "00000000-0000-4000-8000-000000000002",
      expectedCandidateRevision: f.first.candidate.ref.revision,
      tool: "patch_project",
      arguments: {
        expectedMetadataHash: f.metadataHash,
        patch: { set: { title: "Later candidate title" }, unset: [] },
      },
    }),
  });
  assert.equal(later.result.ok, true);

  // When
  const replay = await applyCandidateTool({
    ...f.input, candidate: later.candidate, journal: later.journal, envelope: f.envelope,
  });

  // Then
  assert.deepEqual(replay.result, f.first.result);
  assert.deepEqual(replay.candidate, later.candidate);
  assert.deepEqual(replay.journal, later.journal);
});
