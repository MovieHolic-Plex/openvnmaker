import assert from "node:assert/strict";
import test from "node:test";
import { parseToolEnvelope } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { inspectFixture } from "./operations-inspect-fixture.js";

const missingSelections = [
  { sectionIds: ["missing"] },
  { sectionIds: ["branchFacts", "missing"] },
  { sectionIds: ["branchFacts"], factIds: ["missing"] },
  { sectionIds: ["branchFacts"], factIds: ["world-one"] },
];
for (const selection of missingSelections) {
  test(`read_canon rejects absent or out-of-section selection ${JSON.stringify(selection)}`, async () => {
    // Given
    const f = await inspectFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({ ...f.common, tool: "read_canon", arguments: selection });
    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });
    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "STALE_TARGET");
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
    assert.equal(outcome.journal.calls.length, 1);
    assert.deepEqual(outcome.journal.calls[0]?.result, outcome.result);
  });
}

const readTools: readonly ("project_overview" | "read_canon")[] = ["project_overview", "read_canon"];
for (const tool of readTools) {
  test(`${tool} requires a trusted source head for new receipts`, async () => {
    // Given
    const f = await inspectFixture();
    const { sourceHead, ...input } = f.input;
    assert.ok(sourceHead);
    const envelope = parseToolEnvelope({
      ...f.common, tool, arguments: tool === "read_canon" ? { sectionIds: ["outline"] } : {},
    });
    // When
    const outcome = await applyCandidateTool({ ...input, envelope });
    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "INVALID_STATE");
    assert.strictEqual(outcome.candidate, input.candidate);
  });

  const authorities = [
    { name: "stale revision", candidateId: "00000000-0000-4000-8000-000000000001", expectedCandidateRevision: 3 },
    { name: "wrong candidate", candidateId: "00000000-0000-4000-8000-000000000099", expectedCandidateRevision: 4 },
  ];
  for (const authority of authorities) {
    test(`${tool} rejects ${authority.name} without changing candidate`, async () => {
      // Given
      const f = await inspectFixture();
      const envelope = parseToolEnvelope({
        ...f.common, candidateId: authority.candidateId,
        expectedCandidateRevision: authority.expectedCandidateRevision, tool,
        arguments: tool === "read_canon" ? { sectionIds: ["outline"] } : {},
      });
      // When
      const outcome = await applyCandidateTool({ ...f.input, envelope });
      // Then
      assert.equal(outcome.result.ok, false);
      assert.equal(outcome.result.code, "STALE_HEAD");
      assert.strictEqual(outcome.candidate, f.input.candidate);
    });
  }
}

const cursors = [
  { name: "malformed", value: "malformed" },
  { name: "negative offset", value: `${"a".repeat(64)}:-1` },
  { name: "unsafe integer offset", value: `${"a".repeat(64)}:9007199254740992` },
];
for (const cursor of cursors) {
  test(`overview rejects ${cursor.name} cursor through a normal error receipt`, async () => {
    // Given
    const f = await inspectFixture();
    const envelope = parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: { cursor: cursor.value } });
    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });
    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "INVALID_INPUT");
    assert.strictEqual(outcome.candidate, f.input.candidate);
    assert.deepEqual(outcome.journal.calls[0]?.result, outcome.result);
  });
}
