import { canonicalHash } from "./canonical.js";
import { HarnessError } from "./primitives.js";
import type { Sha256 } from "./primitives.js";
import { decodePng, encodeRgbaPng } from "./image-png.js";
import { hashBytes } from "./image-inspect.js";
import { localDerivativeActionSchema } from "./image-contracts.js";
import type { LocalDerivativeAction } from "./image-contracts.js";

export type SpriteDelivery = {
  readonly action: LocalDerivativeAction;
  readonly bytes: Uint8Array;
};

function channel(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new HarnessError("INVALID_INPUT");
  return value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export async function derivativeDedupeKey(
  originalHash: string, transformId: string, parameters: { readonly maxEdge?: number },
): Promise<string> {
  return canonicalHash({ originalHash, transformId, parameters });
}

export function hasTrueAlpha(rgba: Uint8Array): boolean {
  for (let index = 3; index < rgba.length; index += 4) {
    if (channel(rgba, index) < 255) return true;
  }
  return false;
}

/** Matches ArtImage green-key-v1 constants: dominance/saturation smoothsteps and spill suppression. */
export function applyGreenKeyV1(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    const r = channel(rgba, index) / 255;
    const g = channel(rgba, index + 1) / 255;
    const b = channel(rgba, index + 2) / 255;
    const a = channel(rgba, index + 3) / 255;
    const dominance = g - Math.max(r, b);
    const saturation = (g - Math.min(r, b)) / Math.max(g, 0.001);
    const matte = 1 - smoothstep(0.08, 0.45, dominance) * smoothstep(0.25, 0.65, saturation);
    out[index] = Math.round(r * 255);
    out[index + 1] = Math.round((g - Math.max(0, g - Math.max(r, b)) * (1 - matte)) * 255);
    out[index + 2] = Math.round(b * 255);
    out[index + 3] = Math.round(a * matte * 255);
  }
  return out;
}

export function alphaBounds(rgba: Uint8Array, width: number, height: number): {
  readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number;
} {
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (channel(rgba, (y * width + x) * 4 + 3) === 0) continue;
      found = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return found ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

export async function deriveSpriteDelivery(original: Uint8Array): Promise<SpriteDelivery> {
  const decoded = await decodePng(original);
  const originalHash: Sha256 = await hashBytes(original);
  const preserve = hasTrueAlpha(decoded.rgba);
  const pixels = preserve ? decoded.rgba : applyGreenKeyV1(decoded.rgba);
  const transformId = preserve ? "alpha-preserve-v1" as const : "green-key-v1" as const;
  const bytes = preserve ? original : await encodeRgbaPng(decoded.width, decoded.height, pixels);
  const deliveryHash = preserve ? originalHash : await hashBytes(bytes);
  const action = localDerivativeActionSchema.parse({
    kind: "rederive-delivery", originalHash, deliveryHash, transformId, generationAttempts: 0,
    record: {
      originalHash, deliveryHash, transformId, parameters: {},
      dimensions: { width: decoded.width, height: decoded.height },
      alphaBounds: alphaBounds(pixels, decoded.width, decoded.height), compositing: "alpha",
    },
  });
  return { action, bytes };
}
