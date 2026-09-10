import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalHash, revisionSchema, scriptSchema,
} from "../src/index.js";
import { previewEntrySchema } from "../src/snapshot-contracts.js";
import { buildPreviewSnapshot } from "../src/preview.js";
import { previewFixture } from "./preview-fixture.js";

test("materializes the written chapter when its next chapter exists only in the outline", async () => {
  // Given
  const f = await previewFixture();
  const before = structuredClone(f.source);

  // When
  const result = await buildPreviewSnapshot(f.source, f.request);

  // Then
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.kind, "candidate-preview");
  assert.deepEqual(result.snapshot.materializedScenes, f.fixture.preview.materializedScenes);
  assert.deepEqual(result.snapshot.boundaries, [f.fixture.expected.boundary]);
  assert.deepEqual(result.snapshot.sourceHead, f.source.sourceHead);
  assert.equal(result.snapshot.candidateRevision, f.source.candidate.ref.revision);
  assert.deepEqual(result.snapshot.includedUnitHashes, f.source.includedUnitHashes);
  const { snapshotHash, ...content } = result.snapshot;
  assert.equal(snapshotHash, await canonicalHash(content));
  assert.deepEqual(f.source, before);
});

test("overrides only preview flags when entering with assumed state", async () => {
  // Given
  const f = await previewFixture();
  const source = {
    ...f.source,
    candidate: {
      ...f.source.candidate,
      script: scriptSchema.parse({
        ...f.source.candidate.script, flags: { visits: 0, retained: true },
      }),
    },
  };
  const before = structuredClone(source);
  const request = {
    ...f.request,
    entry: previewEntrySchema.parse({
      kind: "assumed-state", sceneId: "ch01-hall", flags: { visits: 7 },
    }),
  };

  // When
  const result = await buildPreviewSnapshot(source, request);

  // Then
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.entry, request.entry);
  assert.deepEqual(result.snapshot.initialFlags, { visits: 7, retained: true });
  assert.deepEqual(source, before);
});

test("includes only referenced cast when speakers and silent stage actors differ", async () => {
  // Given
  const f = await previewFixture();
  const script = scriptSchema.parse({
    ...f.source.candidate.script,
    characters: ["actor-speech", "actor-scene", "actor-line", "actor-unused"].map(id => ({
      id, name: id, color: "#112233", bio: "",
    })),
    scenes: f.source.candidate.script.scenes.map(scene =>
      scene.id === "ch01-lab" ? {
        ...scene,
        sprites: [{ slot: "left", character: "actor-scene" }],
        lines: scene.lines.map(line => ({
          ...line, speaker: "actor-speech",
          sprites: [{ slot: "center", character: "actor-line" }],
        })),
      } : scene),
  });
  const source = {
    ...f.source,
    candidate: { ...f.source.candidate, script },
    includedUnitHashes: await Promise.all(script.scenes.map(canonicalHash)),
  };

  // When
  const result = await buildPreviewSnapshot(source, f.request);

  // Then
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.cast.map(character => character.id).sort(), [
    "actor-line", "actor-scene", "actor-speech",
  ]);
  assert.deepEqual(result.snapshot.materializedScenes, script.scenes);
});

test("rejects an unregistered legacy speaker rather than substituting a cast member", async () => {
  // Given: the content parser permits legacy me; preview must not invent its actor.
  const f = await previewFixture();
  const script = scriptSchema.parse({
    ...f.source.candidate.script,
    scenes: f.source.candidate.script.scenes.map(scene => ({
      ...scene, lines: scene.lines.map(line => ({ ...line, speaker: "me" })),
    })),
  });
  const source = { ...f.source, candidate: { ...f.source.candidate, script } };
  const before = structuredClone(source);

  // When
  const result = await buildPreviewSnapshot(source, f.request);

  // Then
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_OPERATION");
  assert.deepEqual(source, before);
});

for (const sceneId of ["missing-scene", "ch01-hall"]) {
  test(`rejects from-start entry when ${sceneId} is not the candidate start`, async () => {
    // Given
    const f = await previewFixture();
    const request = {
      ...f.request, entry: previewEntrySchema.parse({ kind: "from-start", sceneId }),
    };

    // When
    const result = await buildPreviewSnapshot(f.source, request);

    // Then
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_INPUT");
  });
}

test("rejects preview creation when the requested candidate revision is stale", async () => {
  // Given
  const f = await previewFixture();
  const request = { ...f.request, expectedCandidateRevision: revisionSchema.parse(0) };

  // When
  const result = await buildPreviewSnapshot(f.source, request);

  // Then
  assert.equal(result.ok, false);
  assert.equal(result.code, "STALE_HEAD");
});

test("rejects unknown destinations rather than disguising them as unwritten boundaries", async () => {
  // Given
  const f = await previewFixture();
  const script = scriptSchema.parse({
    ...f.source.candidate.script,
    scenes: f.source.candidate.script.scenes.map(scene =>
      scene.id === "ch01-exit" ? {
        ...scene, choices: [{ id: "continue", text: "Unknown edge", next: "rogue" }],
      } : scene),
  });
  const source = { ...f.source, candidate: { ...f.source.candidate, script } };
  const before = structuredClone(source);

  // When
  const result = await buildPreviewSnapshot(source, f.request);

  // Then
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_OPERATION");
  assert.deepEqual(source, before);
});

test("keeps an issued preview unchanged when mutable source content changes later", async () => {
  // Given
  const f = await previewFixture();
  const line = { id: "l-a", speaker: null, text: "Before publication" };
  const source = {
    ...f.source,
    candidate: {
      ...f.source.candidate,
      script: {
        ...f.source.candidate.script,
        scenes: f.source.candidate.script.scenes.map(scene =>
          scene.id === "ch01-lab" ? { ...scene, lines: [line] } : scene),
      },
    },
  };
  const issued = await buildPreviewSnapshot(source, f.request);
  assert.equal(issued.ok, true);
  const snapshot = structuredClone(issued.snapshot);

  // When
  line.text = "After publication";

  // Then
  assert.deepEqual(issued.snapshot, snapshot);
  assert.equal(issued.snapshot.materializedScenes[0]?.lines[0]?.text, "Before publication");
});
