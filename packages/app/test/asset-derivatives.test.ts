import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePng, deriveSpriteDelivery, derivativeDedupeKey, encodeRgbaPng, hashBytes } from "@vnmaker/harness";
import { deliveryArtwork, ingestVerifiedDerivative, writeOriginalAsset, type AssetSink } from "../src/storage/assetDerivatives.js";

function rgba(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y);
      const index = (y * width + x) * 4;
      bytes[index] = color[0]; bytes[index + 1] = color[1]; bytes[index + 2] = color[2]; bytes[index + 3] = color[3];
    }
  }
  return bytes;
}

function sink(): AssetSink & { readonly data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    get: (path) => data.get(path),
    put: (path, bytes) => { data.set(path, bytes); },
  };
}

function greenScreen(width: number, height: number): Uint8Array {
  return rgba(width, height, (x, y) => x >= 8 && x < 20 && y >= 6 && y < 18 ? [200, 30, 30, 255] : [0, 255, 0, 255]);
}

test("source-bytes-preserved", async () => {
  const original = await encodeRgbaPng(32, 24, greenScreen(32, 24));
  const copy = original.slice();
  const derived = await deriveSpriteDelivery(original);
  assert.deepEqual(original, copy);
  assert.equal(derived.action.generationAttempts, 0);
  assert.notEqual(derived.action.originalHash, derived.action.deliveryHash);
  assert.equal(derived.action.originalHash, await hashBytes(original));
  const assets = sink();
  const first = await ingestVerifiedDerivative(assets, original, derived.bytes);
  assert.equal(first.originalWrite, "stored");
  assert.notEqual(first.originalPath, first.deliveryPath);
  const second = await ingestVerifiedDerivative(assets, original, derived.bytes);
  assert.equal(second.originalWrite, "preserved");
  assert.deepEqual(assets.get(first.originalPath), original);
  const other = await encodeRgbaPng(32, 24, rgba(32, 24, () => [0, 0, 255, 255]));
  assert.throws(() => writeOriginalAsset(assets, first.originalPath, other), /덮어쓸/);
  assert.deepEqual(assets.get(first.originalPath), original);
});

test("green-key-full-resolution", async () => {
  const original = await encodeRgbaPng(32, 24, greenScreen(32, 24));
  const derived = await deriveSpriteDelivery(original);
  assert.equal(derived.action.record.dimensions.width, 32);
  assert.equal(derived.action.record.dimensions.height, 24);
  assert.notEqual(derived.action.record.dimensions.width, 400);
  assert.equal(derived.action.record.compositing, "alpha");
  assert.equal(derived.action.transformId, "green-key-v1");
  const decoded = await decodePng(derived.bytes);
  assert.equal(decoded.width, 32);
  assert.equal(decoded.height, 24);
  const red = (8 * 32 + 8) * 4;
  const green = (0 * 32 + 0) * 4;
  assert.equal(decoded.rgba[red], 200);
  assert.ok((decoded.rgba[red + 3] ?? 0) > 200);
  assert.equal(decoded.rgba[green + 3], 0);
  const art = deliveryArtwork({ id: "sprite-1", name: "seorin", kind: "character", url: "/assets/user/delivery.png" });
  assert.equal(art.compositing, "alpha");
  assert.equal("prompt" in art, false);
});

test("alpha-delivery-not-keyed-twice", async () => {
  const original = await encodeRgbaPng(8, 8, rgba(8, 8, (x, y) => x < 4 ? [0, 255, 0, 128] : [40, 40, 200, 255]));
  const first = await deriveSpriteDelivery(original);
  assert.equal(first.action.transformId, "alpha-preserve-v1");
  assert.equal(first.action.record.compositing, "alpha");
  const decoded = await decodePng(first.bytes);
  assert.equal(decoded.rgba[3], 128);
  assert.equal(decoded.rgba[0], 0);
  assert.equal(decoded.rgba[1], 255);
  const second = await deriveSpriteDelivery(first.bytes);
  assert.equal(second.action.deliveryHash, first.action.deliveryHash);
  assert.equal(second.action.generationAttempts, 0);
  assert.deepEqual(second.bytes, first.bytes);
});

test("dedupe-keying", async () => {
  const original = await encodeRgbaPng(16, 16, greenScreen(16, 16));
  const first = await deriveSpriteDelivery(original);
  const second = await deriveSpriteDelivery(original);
  assert.equal(first.action.deliveryHash, second.action.deliveryHash);
  const keyA = await derivativeDedupeKey(first.action.originalHash, first.action.transformId, first.action.record.parameters);
  const keyB = await derivativeDedupeKey(second.action.originalHash, second.action.transformId, second.action.record.parameters);
  assert.equal(keyA, keyB);
  assert.notEqual(keyA, first.action.deliveryHash);
  assert.notEqual(first.action.originalHash, first.action.deliveryHash);
});
