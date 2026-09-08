import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../src/canonical.js";
import { readReferenceContext, readSceneContext } from "../src/context.js";
import {
  approvedArtBindingSchema,
  productionDocumentSchema,
} from "../src/production-contracts.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";
import { hash, otherHash } from "./fixtures.js";

const binding = approvedArtBindingSchema.parse({
  assetId: "bg-start", originalHash: hash, deliveryHash: otherHash,
  referenceVersionIds: ["ref-v1"], role: "background",
  target: { kind: "scene", sceneId: "start", slot: "background" },
});
const unrelated = approvedArtBindingSchema.parse({
  ...binding, assetId: "bg-other",
  target: { kind: "scene", sceneId: "other", slot: "background" },
});
const args = toolArgumentsSchemas.read_scene.parse({
  sceneId: "start", limit: 1,
});

test("returns original reference provenance with complete binding hashes", async () => {
  // Given a selected scene binding with distinct original and delivery hashes.
  const base = await selectionSource();
  const source = {
    ...base,
    productionDocument: productionDocumentSchema.parse({
      ...base.productionDocument, referenceBindings: [binding],
    }),
  };
  const window = await readSceneContext(source, args);
  assert.equal(window.kind, "ready");
  const expectedHash = await canonicalHash(binding);
  // When references are selected for that actual read window.
  const result = await readReferenceContext(source, window.window);
  // Then the complete original record is retained, not only an asset ID.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.referenceBindings, [binding]);
  assert.deepEqual(result.referenceBindingHashes, [expectedHash]);
});

test("excludes bindings belonging only to a sibling scene", async () => {
  // Given selected and unrelated approved binding records.
  const base = await selectionSource();
  const source = {
    ...base,
    productionDocument: productionDocumentSchema.parse({
      ...base.productionDocument, referenceBindings: [unrelated, binding],
    }),
  };
  const window = await readSceneContext(source, args);
  assert.equal(window.kind, "ready");
  const expectedHash = await canonicalHash(binding);
  // When references for the selected window are requested.
  const result = await readReferenceContext(source, window.window);
  // Then unrelated bindings are not promoted into this window's context.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.referenceBindings, [binding]);
  assert.deepEqual(result.referenceBindingHashes, [expectedHash]);
});

test("records a newly relevant binding despite unchanged scene content", async () => {
  // Given an added approved binding and unchanged script content.
  const source = await selectionSource();
  const before = await readSceneContext(source, args);
  assert.equal(before.kind, "ready");
  const changed = {
    ...source,
    productionDocument: productionDocumentSchema.parse({
      ...source.productionDocument, referenceBindings: [binding],
    }),
  };
  // When the ordinary reader is used again.
  const result = await readSceneContext(changed, args);
  // Then its forwarded read set exposes the new dependency.
  assert.equal(result.kind, "ready");
  assert.notDeepEqual(result.readSet, before.readSet);
});

for (const replacement of [
  approvedArtBindingSchema.parse({ ...binding, deliveryHash: hash }),
  approvedArtBindingSchema.parse({
    ...binding, referenceVersionIds: ["ref-v2"],
  }),
]) {
  test(`records changed binding content ${replacement.referenceVersionIds.join("-")}-${replacement.deliveryHash}`, async () => {
    // Given changed binding content with stable asset identity and script content.
    const base = await selectionSource();
    const source = {
      ...base,
      productionDocument: productionDocumentSchema.parse({
        ...base.productionDocument, referenceBindings: [binding],
      }),
    };
    const before = await readSceneContext(source, args);
    assert.equal(before.kind, "ready");
    const changed = {
      ...source,
      productionDocument: productionDocumentSchema.parse({
        ...source.productionDocument, referenceBindings: [replacement],
      }),
    };
    // When the ordinary reader sees the revised approval record.
    const result = await readSceneContext(changed, args);
    // Then asset-ID equality cannot hide changed reference inputs.
    assert.equal(result.kind, "ready");
    assert.notDeepEqual(result.readSet, before.readSet);
  });
}

test("does not import unrelated bindings into a scene read dependency", async () => {
  // Given a new binding whose target is outside the selected scene.
  const source = await selectionSource();
  const before = await readSceneContext(source, args);
  assert.equal(before.kind, "ready");
  const changed = {
    ...source,
    productionDocument: productionDocumentSchema.parse({
      ...source.productionDocument, referenceBindings: [unrelated],
    }),
  };
  // When the original scene is read.
  const result = await readSceneContext(changed, args);
  // Then unchanged required content retains its dependency identity.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.readSet, before.readSet);
});
