import { bytesSchema, HarnessError, positiveIntegerSchema } from "./primitives.js";
import type { Sha256 } from "./primitives.js";
import { decodePng, encodeRgbaPng } from "./image-png.js";
import { hashBytes, inspectImageBytes } from "./image-inspect.js";
import type { InspectedImage } from "./image-inspect.js";

export type SentReference = InspectedImage & {
  readonly originalHash: Sha256;
  readonly sentHash: Sha256;
  readonly bytes: Uint8Array;
};

function pixel(source: Uint8Array, index: number): number {
  const value = source[index];
  if (value === undefined) throw new HarnessError("INVALID_INPUT");
  return value;
}

export function resizeRgba(source: Uint8Array, srcW: number, srcH: number, destW: number, destH: number): Uint8Array {
  const width = positiveIntegerSchema.parse(destW);
  const height = positiveIntegerSchema.parse(destH);
  if (source.length !== srcW * srcH * 4) throw new HarnessError("INVALID_INPUT");
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(srcH - 1, Math.floor((y * srcH) / height));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(srcW - 1, Math.floor((x * srcW) / width));
      const from = (srcY * srcW + srcX) * 4;
      const to = (y * width + x) * 4;
      out[to] = pixel(source, from);
      out[to + 1] = pixel(source, from + 1);
      out[to + 2] = pixel(source, from + 2);
      out[to + 3] = pixel(source, from + 3);
    }
  }
  return out;
}

/** Admission uses these sent bytes, not the original identity hash. */
export async function prepareSentReference(original: Uint8Array, maxEdge: number): Promise<SentReference> {
  const edge = positiveIntegerSchema.parse(maxEdge);
  const inspected = inspectImageBytes(original);
  const originalHash = await hashBytes(original);
  const longest = Math.max(inspected.width, inspected.height);
  if (longest <= edge) {
    return { ...inspected, originalHash, sentHash: originalHash, bytes: original };
  }
  if (inspected.mime !== "image/png") throw new HarnessError("LIMIT_EXCEEDED");
  const decoded = await decodePng(original);
  const scale = edge / longest;
  const width = positiveIntegerSchema.parse(Math.max(1, Math.round(decoded.width * scale)));
  const height = positiveIntegerSchema.parse(Math.max(1, Math.round(decoded.height * scale)));
  const sent = await encodeRgbaPng(width, height, resizeRgba(decoded.rgba, decoded.width, decoded.height, width, height));
  const sentInspected = inspectImageBytes(sent);
  return {
    ...sentInspected, originalHash, sentHash: await hashBytes(sent), bytes: sent,
    rawBytes: bytesSchema.parse(sent.byteLength),
  };
}
