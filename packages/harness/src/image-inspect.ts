import { bytesSchema, hashSchema, HarnessError, positiveIntegerSchema } from "./primitives.js";
import type { Bytes, Sha256 } from "./primitives.js";

export type InspectedImage = {
  readonly mime: "image/png" | "image/jpeg" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly rawBytes: Bytes;
};

const PNG = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function u16(bytes: Uint8Array, offset: number): number {
  const hi = bytes[offset], lo = bytes[offset + 1];
  if (hi === undefined || lo === undefined) throw new HarnessError("INVALID_INPUT");
  return (hi << 8) | lo;
}

function u16le(bytes: Uint8Array, offset: number): number {
  const lo = bytes[offset], hi = bytes[offset + 1];
  if (lo === undefined || hi === undefined) throw new HarnessError("INVALID_INPUT");
  return lo | (hi << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset], b1 = bytes[offset + 1], b2 = bytes[offset + 2], b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) throw new HarnessError("INVALID_INPUT");
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function sized(mime: InspectedImage["mime"], width: number, height: number, rawBytes: number): InspectedImage {
  if (width === 0 || height === 0) throw new HarnessError("INVALID_INPUT");
  return { mime, width: positiveIntegerSchema.parse(width), height: positiveIntegerSchema.parse(height), rawBytes: bytesSchema.parse(rawBytes) };
}

function inspectJpeg(bytes: Uint8Array): InspectedImage {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new HarnessError("INVALID_INPUT");
    const marker = bytes[offset + 1];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    const length = u16(bytes, offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return sized("image/jpeg", u16(bytes, offset + 7), u16(bytes, offset + 5), bytes.length);
    offset += 2 + length;
  }
  throw new HarnessError("INVALID_INPUT");
}

function inspectWebp(bytes: Uint8Array): InspectedImage {
  if (bytes.length < 30 || u32(bytes, 0) !== 0x52494646 || u32(bytes, 8) !== 0x57454250) throw new HarnessError("INVALID_INPUT");
  const kind = u32(bytes, 12);
  if (kind === 0x56503858) {
    const b24 = bytes[24], b25 = bytes[25], b26 = bytes[26], b27 = bytes[27], b28 = bytes[28], b29 = bytes[29];
    if (b24 === undefined || b25 === undefined || b26 === undefined || b27 === undefined || b28 === undefined || b29 === undefined)
      throw new HarnessError("INVALID_INPUT");
    return sized("image/webp", 1 + (b24 | (b25 << 8) | (b26 << 16)), 1 + (b27 | (b28 << 8) | (b29 << 16)), bytes.length);
  }
  if (kind === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
    return sized("image/webp", u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff, bytes.length);
  if (kind === 0x5650384c && bytes[20] === 0x2f) {
    const b21 = bytes[21], b22 = bytes[22], b23 = bytes[23], b24 = bytes[24];
    if (b21 === undefined || b22 === undefined || b23 === undefined || b24 === undefined) throw new HarnessError("INVALID_INPUT");
    return sized("image/webp", 1 + (b21 | ((b22 & 0x3f) << 8)), 1 + (((b22 >> 6) | (b23 << 2) | ((b24 & 0x0f) << 10))), bytes.length);
  }
  throw new HarnessError("INVALID_INPUT");
}

export function isHtmlOrXmlBytes(bytes: Uint8Array): boolean {
  let index = 0;
  while (index < bytes.length) {
    const value = bytes[index];
    if (value !== 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) break;
    index += 1;
  }
  const head = new TextDecoder().decode(bytes.subarray(index, index + 72)).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml") ||
    head.startsWith("<head") || head.startsWith("<svg") || head.startsWith("<body");
}

export function inspectImageBytes(bytes: Uint8Array): InspectedImage {
  if (isHtmlOrXmlBytes(bytes)) throw new HarnessError("INVALID_INPUT");
  if (bytes.length >= 24 && PNG.every((value, index) => bytes[index] === value))
    return sized("image/png", u32(bytes, 16), u32(bytes, 20), bytes.length);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return inspectWebp(bytes);
  throw new HarnessError("INVALID_INPUT");
}

export async function hashBytes(bytes: Uint8Array): Promise<Sha256> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return hashSchema.parse(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""));
}
