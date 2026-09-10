import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateRefSchema,
  canonicalHash,
  lineIdSchema,
  parseProductionDocument,
  parseToolEnvelope,
  scriptSchema,
  unitIdSchema,
  writeSetSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { operationJournalSchema } from "../src/operations-receipts.js";
import { productionDocument } from "./fixtures.js";
import { scopedOperationFixtures } from "../../../tests/fixtures/harness/r2-operations.js";

async function lineFixture() {
  const unitId = unitIdSchema.parse("00000000-0000-4000-8000-000000000010");
  const fixture = await scopedOperationFixtures();
  const candidate = {
    ref: candidateRefSchema.parse({
      candidateId: fixture.insert.candidateId,
      revision: 4,
    }),
    script: scriptSchema.parse({
      title: "Scoped line fixture",
      subtitle: "",
      start: fixture.baseline.id,
      characters: [],
      scenes: [fixture.baseline, fixture.otherScene],
    }),
    productionDocument: parseProductionDocument(productionDocument),
  };
  const authorizedWriteSet = writeSetSchema.parse([{
    target: { kind: "scene", sceneId: fixture.baseline.id },
    fields: ["lines"],
  }]);
  const journal = operationJournalSchema.parse({
    candidateId: candidate.ref.candidateId, calls: [], allocations: [],
  });
  return { journal, unitId, fixture, candidate, authorizedWriteSet };
}

test("inserts a harness-identified line when the scoped gap is adjacent", async () => {
  // Given
  const { journal, unitId, fixture, candidate, authorizedWriteSet } = await lineFixture();
  const before = structuredClone(candidate);

  // When
  const outcome = await applyCandidateTool({
    journal,
    unitId,
    candidate,
    authorizedWriteSet,
    envelope: fixture.insert,
  });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  const lines = outcome.candidate.script.scenes[0]?.lines;
  assert.ok(lines);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], fixture.baseline.lines[0]);
  assert.deepEqual(lines[2], fixture.baseline.lines[1]);
  const inserted = lines[1];
  assert.ok(inserted);
  lineIdSchema.parse(inserted.id);
  assert.notEqual(inserted.id, "new-line");
  assert.notEqual(inserted.id, "l-a");
  assert.notEqual(inserted.id, "l-b");
  assert.equal(inserted.text, "Synthetic candidate");
  assert.deepEqual(outcome.candidate.script.scenes[1], fixture.otherScene);
  assert.deepEqual(candidate, before);
});

const rearrangements = [
  {
    operation: { kind: "delete" },
    expectedIds: ["l-b"],
  },
  {
    operation: {
      kind: "move",
      gap: { leftId: "l-b", rightId: null },
    },
    expectedIds: ["l-b", "l-a"],
  },
] as const;

for (const scenario of rearrangements) {
  test(`applies ${scenario.operation.kind} when the scoped target hash matches`, async () => {
    // Given
    const { journal, unitId, fixture, candidate, authorizedWriteSet } = await lineFixture();
    const before = structuredClone(candidate);
    const target = fixture.baseline.lines[0];
    assert.ok(target);
    const envelope = parseToolEnvelope({
      callId: fixture.update.callId,
      candidateId: candidate.ref.candidateId,
      expectedCandidateRevision: candidate.ref.revision,
      tool: "patch_lines",
      arguments: {
        sceneId: fixture.baseline.id,
        operations: [{
          ...scenario.operation,
          lineId: "l-a",
          expectedEntityHash: await canonicalHash(target),
        }],
      },
    });

    // When
    const outcome = await applyCandidateTool({
      journal,
      unitId,
      candidate,
      authorizedWriteSet,
      envelope,
    });

    // Then
    assert.equal(outcome.result.ok, true);
    assert.equal(outcome.result.changed, true);
    assert.equal(outcome.candidate.ref.revision, 5);
    const lines = outcome.candidate.script.scenes[0]?.lines;
    assert.ok(lines);
    assert.deepEqual(lines.map(line => line.id), scenario.expectedIds);
    for (const line of lines) {
      assert.deepEqual(
        line,
        fixture.baseline.lines.find(original => original.id === line.id),
      );
    }
    assert.deepEqual(outcome.candidate.script.scenes[1], fixture.otherScene);
    assert.deepEqual(candidate, before);
  });
}

test("allocates distinct IDs when separate units reuse a client key", async () => {
  // Given: one unit has already inserted its own new-line key.
  const { journal, unitId, fixture, candidate, authorizedWriteSet } = await lineFixture();
  const first = await applyCandidateTool({
    journal,
    unitId,
    candidate,
    authorizedWriteSet,
    envelope: fixture.insert,
  });
  assert.equal(first.result.ok, true);
  const before = structuredClone(first.candidate);
  const firstId = first.candidate.script.scenes[0]?.lines[1]?.id;
  assert.ok(firstId);
  const envelope = parseToolEnvelope({
    callId: "00000000-0000-4000-8000-000000000012",
    candidateId: first.candidate.ref.candidateId,
    expectedCandidateRevision: first.candidate.ref.revision,
    tool: "patch_lines",
    arguments: {
      sceneId: fixture.baseline.id,
      operations: [{
        kind: "insert",
        gap: { leftId: "l-b", rightId: null },
        lines: [{
          clientKey: "new-line",
          value: { speaker: null, text: "Second unit output" },
        }],
      }],
    },
  });

  // When
  const outcome = await applyCandidateTool({
    journal: first.journal,
    unitId: unitIdSchema.parse("00000000-0000-4000-8000-000000000011"),
    candidate: first.candidate,
    authorizedWriteSet,
    envelope,
  });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.candidate.ref.revision, 6);
  const lines = outcome.candidate.script.scenes[0]?.lines;
  assert.ok(lines);
  assert.equal(lines.length, 4);
  assert.equal(lines[1]?.id, firstId);
  const secondId = lines[3]?.id;
  assert.ok(secondId);
  lineIdSchema.parse(secondId);
  assert.notEqual(secondId, firstId);
  assert.deepEqual(outcome.candidate.script.scenes[1], fixture.otherScene);
  assert.deepEqual(first.candidate, before);
});
