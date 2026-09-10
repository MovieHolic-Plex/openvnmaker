import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, parseProductionDocument } from "../src/index.js";
import { buildPreviewSnapshot } from "../src/preview.js";
import { previewMissingAssetSchema } from "../src/snapshot-contracts.js";
import { previewFixture } from "./preview-fixture.js";

async function missingAssetFixture() {
  const f = await previewFixture();
  const missing = previewMissingAssetSchema.parse({
    assetId: "pending-background", name: "Chapter-one background",
    role: "background",
    target: { kind: "scene", sceneId: "ch01-lab", slot: "background" },
  });
  return {
    ...f, missing,
    source: { ...f.source, missingAssets: [missing] },
    request: { ...f.request, allowMissingAssetPlaceholders: true },
  };
}

test("rejects missing assets when placeholder playback was not explicitly allowed", async () => {
  // Given
  const f = await missingAssetFixture();
  const before = structuredClone(f.source);
  const request = { ...f.request, allowMissingAssetPlaceholders: false };

  // When
  const result = await buildPreviewSnapshot(f.source, request);

  // Then
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_STATE");
  assert.deepEqual(f.source, before);
});

test("captures named placeholder targets without changing manuscript fields when allowed", async () => {
  // Given
  const f = await missingAssetFixture();
  const before = structuredClone(f.source);
  const expectedContent = { ...f.fixture.preview, missingAssets: [f.missing] };
  Reflect.deleteProperty(expectedContent, "snapshotHash");
  const expectedHash = await canonicalHash(expectedContent);

  // When
  const result = await buildPreviewSnapshot(f.source, f.request);

  // Then
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.missingAssets, [f.missing]);
  assert.equal(result.snapshot.snapshotHash, expectedHash);
  assert.deepEqual(result.snapshot.materializedScenes, f.source.candidate.script.scenes);
  assert.deepEqual(result.snapshot.assetBindings, []);
  assert.deepEqual(f.source, before);
});

test("preserves the legacy snapshot shape when no assets are missing", async () => {
  // Given
  const f = await previewFixture();
  const request = { ...f.request, allowMissingAssetPlaceholders: true };

  // When
  const result = await buildPreviewSnapshot(f.source, request);

  // Then
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.missingAssets, undefined);
  assert.equal(result.snapshot.snapshotHash, f.fixture.preview.snapshotHash);
});

test("withholds unavailable bindings while retaining other ready bindings", async () => {
  // Given
  const f = await missingAssetFixture();
  const missingBinding = {
    assetId: f.missing.assetId, originalHash: "a".repeat(64), deliveryHash: "b".repeat(64),
    referenceVersionIds: [], role: "background", target: f.missing.target,
  };
  const readyBinding = {
    assetId: "ready-background", originalHash: "c".repeat(64), deliveryHash: "d".repeat(64),
    referenceVersionIds: [], role: "background",
    target: { kind: "scene", sceneId: "ch01-hall", slot: "background" },
  };
  const source = {
    ...f.source,
    candidate: {
      ...f.source.candidate,
      productionDocument: parseProductionDocument({
        ...f.source.candidate.productionDocument,
        referenceBindings: [missingBinding, readyBinding],
      }),
    },
  };
  const before = structuredClone(source);

  // When
  const result = await buildPreviewSnapshot(source, f.request);

  // Then
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.assetBindings, [readyBinding]);
  assert.deepEqual(result.snapshot.missingAssets, [f.missing]);
  assert.deepEqual(source, before);
});

test("keeps placeholder metadata detached when the source asset label changes later", async () => {
  // Given
  const f = await missingAssetFixture();
  const mutable = { ...f.missing };
  const source = { ...f.source, missingAssets: [mutable] };
  const issued = await buildPreviewSnapshot(source, f.request);
  assert.equal(issued.ok, true);

  // When
  mutable.name = "Later asset label";

  // Then
  assert.equal(issued.snapshot.missingAssets?.[0]?.name, f.missing.name);
});
