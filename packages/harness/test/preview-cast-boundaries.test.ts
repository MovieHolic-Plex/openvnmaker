import assert from "node:assert/strict";
import { test } from "node:test";
import { previewSnapshotSchema, scriptSchema } from "@vnmaker/harness";
import { hash, head, script, uuid } from "./fixtures.js";

const firstCharacter = { id: "ada", name: "Ada", color: "#112233", bio: "First character" };
const secondCharacter = { id: "bea", name: "Bea", color: "#445566", bio: "Second character" };
const scenes = [...script.scenes, { ...script.scenes[0], id: "other" }];
const preview = { kind: "candidate-preview", previewId: uuid, projectId: head.projectId, runId: uuid,
  candidateId: uuid, candidateRevision: 4, sourceHead: head, snapshotHash: hash,
  entry: { kind: "from-start", sceneId: "start" }, materializedScenes: scenes,
  cast: [firstCharacter, secondCharacter], initialFlags: {}, assetBindings: [], boundaries: [], includedUnitHashes: [] };

test("B1 rejects preview cast when different character names share one ID", () => {
  // Given: the complete fixture is valid before changing only the second character's ID.
  previewSnapshotSchema.parse(preview);
  const input = { ...preview, cast: [firstCharacter, { ...secondCharacter, id: firstCharacter.id }] };
  // When
  const result = previewSnapshotSchema.safeParse(input);
  // Then
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.error.issues.map(issue => issue.path), [["cast"]]);
});

test("B1 preserves preview cast when distinct IDs share a name and scenes reuse line IDs", () => {
  // Given
  const input = { ...preview, cast: [firstCharacter, { ...secondCharacter, name: firstCharacter.name }] };
  // When
  const parsed = previewSnapshotSchema.parse(input);
  // Then
  assert.deepEqual(parsed, input);
});

test("B1 preserves source script when distinct character IDs and cross-scene line IDs are valid", () => {
  // Given
  const input = { ...script, characters: preview.cast, scenes };
  // When
  const parsed = scriptSchema.parse(input);
  // Then
  assert.deepEqual(parsed, input);
});
