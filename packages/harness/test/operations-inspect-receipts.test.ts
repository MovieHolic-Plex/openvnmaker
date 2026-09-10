import assert from "node:assert/strict";
import test from "node:test";
import { parseToolEnvelope, revisionSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { inspectFixture, overviewDataSchema, secondCallId } from "./operations-inspect-fixture.js";

test("overview continuation receipt replays exactly after candidate revision changes", async () => {
  // Given a real continuation receipt from two successful pages.
  const f = await inspectFixture();
  const first = await applyCandidateTool({
    ...f.input, envelope: parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: { limit: 40 } }),
  });
  assert.equal(first.result.ok, true);
  const page = overviewDataSchema.parse(first.result.data);
  const envelope = parseToolEnvelope({
    ...f.common, callId: secondCallId, tool: "project_overview",
    arguments: { cursor: page.nextCursor, limit: 40 },
  });
  const second = await applyCandidateTool({ ...f.input, journal: first.journal, envelope });
  assert.equal(second.result.ok, true);
  const candidate = { ...f.input.candidate, ref: { ...f.input.candidate.ref, revision: revisionSchema.parse(5) } };
  // When
  const replay = await applyCandidateTool({ ...f.input, journal: second.journal, candidate, envelope });
  // Then
  assert.deepEqual(replay.result, second.result);
  assert.strictEqual(replay.journal, second.journal);
  assert.strictEqual(replay.candidate, candidate);
  assert.equal(replay.candidate.ref.revision, 5);
});

test("canon receipt replays exactly after candidate revision changes", async () => {
  // Given
  const f = await inspectFixture();
  const envelope = parseToolEnvelope({ ...f.common, tool: "read_canon", arguments: { sectionIds: ["branchFacts"] } });
  const first = await applyCandidateTool({ ...f.input, envelope });
  assert.equal(first.result.ok, true);
  const candidate = { ...f.input.candidate, ref: { ...f.input.candidate.ref, revision: revisionSchema.parse(5) } };
  // When
  const replay = await applyCandidateTool({ ...f.input, journal: first.journal, candidate, envelope });
  // Then
  assert.deepEqual(replay.result, first.result);
  assert.strictEqual(replay.journal, first.journal);
  assert.strictEqual(replay.candidate, candidate);
});

test("canon receipt rejects changed payload under the same call ID before stale revision", async () => {
  // Given
  const f = await inspectFixture();
  const envelope = parseToolEnvelope({ ...f.common, tool: "read_canon", arguments: { sectionIds: ["branchFacts"] } });
  const first = await applyCandidateTool({ ...f.input, envelope });
  assert.equal(first.result.ok, true);
  const candidate = { ...f.input.candidate, ref: { ...f.input.candidate.ref, revision: revisionSchema.parse(5) } };
  const conflictEnvelope = parseToolEnvelope({ ...envelope, arguments: { sectionIds: ["outline"] } });
  // When
  const conflict = await applyCandidateTool({ ...f.input, journal: first.journal, candidate, envelope: conflictEnvelope });
  // Then
  assert.equal(conflict.result.ok, false);
  assert.equal(conflict.result.code, "ID_PAYLOAD_CONFLICT");
  assert.strictEqual(conflict.journal, first.journal);
  assert.strictEqual(conflict.candidate, candidate);
});
