import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, parseToolEnvelope, writeSetSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectFixture } from "./operations-project-fixture.js";

const selections = [
  {
    tool: "patch_lines", field: "lines", identity: { lineId: "l-a" },
    target: { kind: "line", sceneId: "start", lineId: "l-a" }, otherField: "speaker",
  },
  {
    tool: "patch_choices", field: "choices", identity: { choiceId: "c-a" },
    target: { kind: "choice", sceneId: "start", choiceId: "c-a" }, otherField: "next",
  },
] as const;

for (const selection of selections) {
  test(`authorizes selected ${selection.field} text without granting the whole scene`, async () => {
    // Given
    const f = await projectFixture();
    const scene = f.input.candidate.script.scenes[0];
    assert.ok(scene);
    const entities = { patch_lines: scene.lines[0], patch_choices: scene.choices?.[0] };
    const entity = entities[selection.tool];
    assert.ok(entity);
    const before = structuredClone(f.input.candidate);
    const scope = writeSetSchema.parse([{ target: selection.target, fields: ["text"] }]);
    const envelope = parseToolEnvelope({
      ...f.common, tool: selection.tool,
      arguments: { sceneId: "start", operations: [{
        kind: "update", ...selection.identity,
        expectedEntityHash: await canonicalHash(entity),
        patch: { set: { text: "Selected edit" }, unset: [] },
      }] },
    });
    const expectedScene = {
      ...scene,
      [selection.field]: (scene[selection.field] ?? []).map(row =>
        row.id === entity.id ? { ...row, text: "Selected edit" } : row),
    };

    // When
    const outcome = await applyCandidateTool({
      ...f.input, authorizedWriteSet: scope, envelope,
    });

    // Then
    assert.equal(outcome.result.ok, true);
    assert.deepEqual(outcome.candidate.script.scenes[0], expectedScene);
    assert.deepEqual(outcome.candidate.script.scenes.slice(1), before.script.scenes.slice(1));
    assert.deepEqual(outcome.result.writeSet, scope);
    assert.deepEqual(outcome.journal.calls[0]?.requiredWriteSet, scope);
    assert.deepEqual(f.input.candidate, before);
  });

  test(`rejects selected ${selection.field} mutation when a different field was granted`, async () => {
    // Given
    const f = await projectFixture();
    const scene = f.input.candidate.script.scenes[0];
    assert.ok(scene);
    const entities = { patch_lines: scene.lines[0], patch_choices: scene.choices?.[0] };
    const entity = entities[selection.tool];
    assert.ok(entity);
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: selection.tool,
      arguments: { sceneId: "start", operations: [{
        kind: "update", ...selection.identity, expectedEntityHash: await canonicalHash(entity),
        patch: { set: { text: "Denied edit" }, unset: [] },
      }] },
    });

    // When
    const outcome = await applyCandidateTool({
      ...f.input, envelope,
      authorizedWriteSet: writeSetSchema.parse([{
        target: selection.target, fields: [selection.otherField],
      }]),
    });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "WRITE_SCOPE_DENIED");
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(outcome.journal, f.input.journal);
  });
}

test("retains required authorization when a no-op receipt has an empty write set", async () => {
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
  assert.deepEqual(first.result.writeSet, []);

  // When
  const replay = await applyCandidateTool({
    ...f.input, candidate: first.candidate, journal: first.journal,
    authorizedWriteSet: [], envelope,
  });

  // Then
  assert.equal(replay.result.ok, false);
  assert.equal(replay.result.code, "WRITE_SCOPE_DENIED");
  assert.deepEqual(first.journal.calls[0]?.requiredWriteSet, [
    { target: { kind: "project" }, fields: ["title"] },
  ]);
  assert.deepEqual(replay.journal, first.journal);
  assert.deepEqual(replay.candidate, first.candidate);
});

test("retains proposal authority when the receipt never changed candidate content", async () => {
  // Given
  const f = await projectFixture();
  const scope = writeSetSchema.parse([{
    target: { kind: "canon", sectionId: "worldTimeline" }, fields: ["proposal"],
  }]);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "propose_canon",
    arguments: {
      sectionId: "worldTimeline",
      expectedSectionHash: await canonicalHash({ kind: "entries", entries: [] }),
      replacement: { kind: "entries", entries: [] }, reason: "Review request",
    },
  });
  const first = await applyCandidateTool({ ...f.input, authorizedWriteSet: scope, envelope });
  assert.equal(first.result.ok, true);
  assert.deepEqual(first.result.writeSet, []);

  // When
  const replay = await applyCandidateTool({
    ...f.input, candidate: first.candidate, journal: first.journal,
    authorizedWriteSet: [], envelope,
  });

  // Then
  assert.equal(replay.result.ok, false);
  assert.equal(replay.result.code, "WRITE_SCOPE_DENIED");
  assert.deepEqual(first.journal.calls[0]?.requiredWriteSet, scope);
  assert.deepEqual(replay.journal, first.journal);
  assert.deepEqual(replay.candidate, first.candidate);
});
