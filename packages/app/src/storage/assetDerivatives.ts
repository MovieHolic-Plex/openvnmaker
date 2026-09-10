import type { Artwork, MediaProvenance } from "@vnmaker/content";
import { deriveSpriteDelivery } from "@vnmaker/harness";
import { describeImage, imageFormat } from "./projectAssets.js";

export type AssetSink = {
  get(path: string): Uint8Array | undefined;
  put(path: string, bytes: Uint8Array): void;
};

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function writeOriginalAsset(sink: AssetSink, path: string, bytes: Uint8Array): "stored" | "preserved" {
  const existing = sink.get(path);
  if (existing === undefined) {
    sink.put(path, bytes);
    return "stored";
  }
  if (!equal(existing, bytes)) throw new Error("원본 자산을 덮어쓸 수 없습니다.");
  return "preserved";
}

export async function ingestVerifiedDerivative(
  sink: AssetSink,
  originalBytes: Uint8Array,
  deliveryBytes: Uint8Array,
): Promise<{
  readonly originalPath: string;
  readonly deliveryPath: string;
  readonly originalWrite: "stored" | "preserved";
  readonly deliveryWrite: "stored" | "preserved";
  readonly originalFormat: { readonly extension: string; readonly mime: string };
  readonly deliveryFormat: { readonly extension: string; readonly mime: string };
}> {
  const originalFormat = imageFormat(originalBytes);
  const deliveryFormat = imageFormat(deliveryBytes);
  const originalCopy = new Uint8Array(originalBytes.byteLength);
  const deliveryCopy = new Uint8Array(deliveryBytes.byteLength);
  originalCopy.set(originalBytes);
  deliveryCopy.set(deliveryBytes);
  const original = await describeImage(new Blob([originalCopy]));
  const delivery = await describeImage(new Blob([deliveryCopy]));
  return {
    originalPath: original.path, deliveryPath: delivery.path,
    originalWrite: writeOriginalAsset(sink, original.path, originalBytes),
    deliveryWrite: writeOriginalAsset(sink, delivery.path, deliveryBytes),
    originalFormat, deliveryFormat,
  };
}

export function deliveryArtwork(input: {
  readonly id: string;
  readonly name: string;
  readonly kind: Artwork["kind"];
  readonly url: string;
  readonly provenance?: MediaProvenance;
}): Artwork {
  return { id: input.id, name: input.name, kind: input.kind, url: input.url, compositing: "alpha",
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }) };
}

export { deriveSpriteDelivery };
