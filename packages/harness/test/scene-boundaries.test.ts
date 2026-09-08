import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunCommandSchema, DEFAULT_BUDGET_LIMITS, importedCandidateSeedSchema, parseSnapshotJson,
  previewSnapshotSchema, releaseSnapshotSchema, sceneSchema, scriptSchema } from "@vnmaker/harness";
import { hash, head, productionDocument, script, uuid } from "./fixtures.js";

const line = { id: "shared", speaker: null, text: "Hello" };
const choice = { id: "shared", text: "Go", next: "start" };
const scene = { id: "start", background: "title", lines: [line], choices: [choice] };
const preview = { kind: "candidate-preview", previewId: uuid, projectId: head.projectId, runId: uuid,
  candidateId: uuid, candidateRevision: 4, sourceHead: head, snapshotHash: hash,
  entry: { kind: "from-start", sceneId: "start" }, cast: [], initialFlags: {}, assetBindings: [],
  boundaries: [], includedUnitHashes: [] };
const seed = { productionDocument, reviews: [], assetManifest: [], provenance: "imported" };
const boundaries = [
  { name: "preview", parse: (scenes: unknown) => previewSnapshotSchema.parse({ ...preview, materializedScenes: scenes }) },
  { name: "imported seed", parse: (scenes: unknown) => importedCandidateSeedSchema.parse({ ...seed, scenes }) },
  { name: "imported run JSON", parse: (scenes: unknown) => parseSnapshotJson(createRunCommandSchema, JSON.stringify({
    requestId: uuid, sourceHead: head, script, productionDocument, limits: DEFAULT_BUDGET_LIMITS,
    tokenPolicy: "exact-only", initialScope: "imported-draft", importedCandidateSeed: { ...seed, scenes }, archiveHash: hash,
  })) },
  { name: "script", parse: (scenes: unknown) => scriptSchema.parse({ ...script, scenes }) },
  { name: "release", parse: (scenes: unknown) => releaseSnapshotSchema.parse({ kind: "release", releaseId: hash,
    sourceHead: head, sourceScriptHash: hash, publicScript: { ...script, scenes }, publicScriptHash: hash, assets: [],
    approval: { kind: "manual-export", headDigest: hash }, exporterVersion: "1", runtimeVersion: "1" }) },
];

for (const [kind, value] of [
  ["line", { ...scene, lines: [line, { ...line, text: "Different" }] }],
  ["choice", { ...scene, choices: [choice, { ...choice, text: "Different" }] }],
] as const) {
  test(`B1 rejects scene when a ${kind} identity repeats locally`, () => {
    // Given
    const input = structuredClone(value);
    // When
    const result = sceneSchema.safeParse(input);
    // Then
    assert.equal(result.success, false);
  });
}
for (const boundary of boundaries) {
  for (const [kind, scenes] of [
    ["line", [{ ...scene, lines: [line, { ...line, text: "Different" }] }]],
    ["choice", [{ ...scene, choices: [choice, { ...choice, text: "Different" }] }]],
    ["scene", [scene, { ...scene, lines: [{ ...line, text: "Different" }] }]],
  ] as const) {
    test(`B1 rejects ${boundary.name} when a ${kind} identity repeats in its scope`, () => {
      // Given
      const input = structuredClone(scenes);
      // When / Then
      assert.throws(() => boundary.parse(input));
    });
  }
  test(`B1 preserves ${boundary.name} when distinct scenes reuse line and choice identities`, () => {
    // Given: identities are scoped by both scene and entity kind, not globally unique.
    const scenes = [scene, { ...scene, id: "other", lines: [{ ...line, text: "Different" }] }];
    // When / Then
    assert.doesNotThrow(() => boundary.parse(scenes));
  });
  test(`B1 preserves ${boundary.name} when legacy entries omit identities`, () => {
    // Given
    const scenes = [{ ...scene, lines: [line, { speaker: null, text: "One" }, { speaker: null, text: "Two" }],
      choices: [choice, { text: "One", next: "start", cond: "" }, { text: "Two", next: "start" }] }];
    // When / Then
    assert.doesNotThrow(() => boundary.parse(scenes));
  });
}
test("B1 preserves empty imported scenes when a draft has no materialized content", () => {
  // Given
  const input = { ...seed, scenes: [] };
  // When
  const parsed = importedCandidateSeedSchema.parse(input);
  // Then
  assert.deepEqual(parsed, input);
});
