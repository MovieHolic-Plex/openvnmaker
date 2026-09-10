import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateRefSchema,
  canonicalHash,
  choiceIdSchema,
  parseProductionDocument,
  parseToolEnvelope,
  scriptSchema,
  unitIdSchema,
  writeSetSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { operationJournalSchema } from "../src/operations-receipts.js";
import { productionDocument, uuid } from "./fixtures.js";

async function choiceFixture() {
  const first = {
    id: "c-a", text: "First", next: "end", affection: 1,
    cond: "", when: { all: ["ready"] }, add: { coins: 1 },
  };
  const second = { id: "c-b", text: "Second", next: "end" };
  const line = { id: "l-a", speaker: null, text: "Choose" };
  const other = {
    id: "other", background: "title", lines: [line],
    choices: [{ id: "c-a", text: "Other scoped choice", next: "end" }],
  };
  const candidate = {
    ref: candidateRefSchema.parse({ candidateId: uuid, revision: 4 }),
    script: scriptSchema.parse({
      title: "Choice fixture", subtitle: "", start: "start", characters: [],
      flags: { ready: true, coins: 0 },
      scenes: [
        { id: "start", background: "title", lines: [line], choices: [first, second] },
        other,
        { id: "end", background: "title", lines: [line], ending: "End" },
      ],
    }),
    productionDocument: parseProductionDocument(productionDocument),
  };
  const input = {
    journal: operationJournalSchema.parse({
      candidateId: candidate.ref.candidateId, calls: [], allocations: [],
    }),
    unitId: unitIdSchema.parse(uuid),
    candidate,
    authorizedWriteSet: writeSetSchema.parse([{
      target: { kind: "scene", sceneId: "start" }, fields: ["choices"],
    }]),
  };
  const common = {
    callId: uuid, candidateId: uuid, expectedCandidateRevision: 4,
    tool: "patch_choices",
  } as const;
  const update = {
    kind: "update", choiceId: "c-a",
    expectedEntityHash: await canonicalHash(first),
    patch: { set: { text: "Revised" }, unset: ["affection"] },
  } as const;
  return { input, common, update, first, second, other };
}

test("updates choice fields when the scoped hash matches", async () => {
  // Given
  const f = await choiceFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, arguments: { sceneId: "start", operations: [f.update] },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  const revised = outcome.candidate.script.scenes[0]?.choices?.[0];
  assert.deepEqual(revised, {
    id: "c-a", text: "Revised", next: "end", cond: "",
    when: { all: ["ready"] }, add: { coins: 1 },
  });
  assert.deepEqual(outcome.candidate.script.scenes[0]?.choices?.[1], f.second);
  assert.deepEqual(outcome.candidate.script.scenes[1], f.other);
  assert.deepEqual(f.input.candidate, before);
});

test("inserts an identified choice when its gap is adjacent", async () => {
  // Given
  const f = await choiceFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common,
    arguments: { sceneId: "start", operations: [{
      kind: "insert", gap: { leftId: "c-a", rightId: "c-b" },
      choices: [{ clientKey: "new-choice", value: { text: "Third", next: "end" } }],
    }] },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  const choices = outcome.candidate.script.scenes[0]?.choices;
  assert.ok(choices);
  assert.equal(choices.length, 3);
  assert.deepEqual(choices[0], f.first);
  assert.deepEqual(choices[2], f.second);
  const inserted = choices[1];
  assert.ok(inserted);
  choiceIdSchema.parse(inserted.id);
  assert.notEqual(inserted.id, "new-choice");
  assert.notEqual(inserted.id, "c-a");
  assert.notEqual(inserted.id, "c-b");
  assert.equal(inserted.text, "Third");
  assert.equal(inserted.next, "end");
  assert.deepEqual(outcome.candidate.script.scenes[1], f.other);
  assert.deepEqual(f.input.candidate, before);
});

const rearrangements = [
  { operation: { kind: "delete" }, expectedIds: ["c-b"] },
  {
    operation: { kind: "move", gap: { leftId: "c-b", rightId: null } },
    expectedIds: ["c-b", "c-a"],
  },
] as const;

for (const scenario of rearrangements) {
  test(`applies choice ${scenario.operation.kind} when the scoped hash matches`, async () => {
    // Given
    const f = await choiceFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, arguments: { sceneId: "start", operations: [{
        ...scenario.operation, choiceId: "c-a",
        expectedEntityHash: f.update.expectedEntityHash,
      }] },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, true);
    assert.equal(outcome.candidate.ref.revision, 5);
    assert.deepEqual(
      outcome.candidate.script.scenes[0]?.choices,
      scenario.expectedIds.map(id => [f.first, f.second].find(choice => choice.id === id)),
    );
    assert.deepEqual(outcome.candidate.script.scenes[1], f.other);
    assert.deepEqual(f.input.candidate, before);
  });
}

const failures = [
  {
    name: "missing target",
    operation: { kind: "delete", choiceId: "missing", expectedEntityHash: "b".repeat(64) },
    code: "STALE_TARGET",
  },
  {
    name: "nonadjacent gap",
    operation: {
      kind: "insert", gap: { leftId: "c-a", rightId: null },
      choices: [{ clientKey: "new-choice", value: { text: "Third", next: "end" } }],
    },
    code: "STALE_GAP",
  },
] as const;

for (const scenario of failures) {
  test(`rejects the whole choice batch when a later operation has a ${scenario.name}`, async () => {
    // Given
    const f = await choiceFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common,
      arguments: { sceneId: "start", operations: [f.update, scenario.operation] },
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

test("rejects choice mutation when the unit lacks write authorization", async () => {
  // Given
  const f = await choiceFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, arguments: { sceneId: "start", operations: [f.update] },
  });

  // When
  const outcome = await applyCandidateTool({
    ...f.input, authorizedWriteSet: [], envelope,
  });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "WRITE_SCOPE_DENIED");
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});
