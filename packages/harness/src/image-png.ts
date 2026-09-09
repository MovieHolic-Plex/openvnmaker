import { HarnessError, positiveIntegerSchema } from "./primitives.js";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  CRC_TABLE[index] = crc;
}

export type DecodedPng = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const entry = CRC_TABLE[(crc ^ byte) & 0xff];
    if (entry === undefined) throw new HarnessError("INVALID_INPUT");
    crc = entry ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset], b1 = bytes[offset + 1], b2 = bytes[offset + 2], b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) throw new HarnessError("INVALID_INPUT");
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function putU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function blobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function zlib(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([blobPart(bytes)]).stream().pipeThrough(stream)).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  putU32(bytes, 0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  const body = bytes.subarray(4, 8 + data.length);
  putU32(bytes, 8 + data.length, crc32(body));
  return bytes;
}

function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const leftDelta = Math.abs(estimate - left);
  const upDelta = Math.abs(estimate - up);
  const cornerDelta = Math.abs(estimate - corner);
  if (leftDelta <= upDelta && leftDelta <= cornerDelta) return left;
  return upDelta <= cornerDelta ? up : corner;
}

function unfilter(filter: number, row: Uint8Array, previous: Uint8Array | null, bpp: number): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const x = row[index];
    if (x === undefined) throw new HarnessError("INVALID_INPUT");
    const left = index >= bpp ? (out[index - bpp] ?? 0) : 0;
    const up = previous?.[index] ?? 0;
    const corner = index >= bpp ? (previous?.[index - bpp] ?? 0) : 0;
    let recon = 0;
    switch (filter) {
      case 0: recon = 0; break;
      case 1: recon = left; break;
      case 2: recon = up; break;
      case 3: recon = Math.floor((left + up) / 2); break;
      case 4: recon = paeth(left, up, corner); break;
      default: throw new HarnessError("INVALID_INPUT");
    }
    out[index] = (x + recon) & 0xff;
  }
  return out;
}

function toRgba(row: Uint8Array, colorType: number, width: number): Uint8Array {
  const rgba = new Uint8Array(width * 4);
  if (colorType === 6) {
    if (row.length !== width * 4) throw new HarnessError("INVALID_INPUT");
    rgba.set(row);
    return rgba;
  }
  if (colorType !== 2 || row.length !== width * 3) throw new HarnessError("INVALID_INPUT");
  for (let pixel = 0; pixel < width; pixel += 1) {
    const source = pixel * 3, dest = pixel * 4;
    const r = row[source], g = row[source + 1], b = row[source + 2];
    if (r === undefined || g === undefined || b === undefined) throw new HarnessError("INVALID_INPUT");
    rgba[dest] = r; rgba[dest + 1] = g; rgba[dest + 2] = b; rgba[dest + 3] = 255;
  }
  return rgba;
}

/** Filter-0 RGBA PNG. Used for fixtures and full-resolution delivery bytes. */
export async function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const w = positiveIntegerSchema.parse(width);
  const h = positiveIntegerSchema.parse(height);
  if (rgba.length !== w * h * 4) throw new HarnessError("INVALID_INPUT");
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y += 1) {
    const offset = y * (1 + w * 4);
    raw[offset] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), offset + 1);
  }
  const ihdr = new Uint8Array(13);
  putU32(ihdr, 0, w); putU32(ihdr, 4, h);
  ihdr[8] = 8; ihdr[9] = 6;
  const parts = [Uint8Array.from(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", await zlib(raw, new CompressionStream("deflate"))), chunk("IEND", new Uint8Array())];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  if (bytes.length < 33 || !SIGNATURE.every((value, index) => bytes[index] === value)) throw new HarnessError("INVALID_INPUT");
  let offset = 8, width = 0, height = 0, colorType = -1;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new HarnessError("INVALID_INPUT");
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== u32(bytes, offset + 8 + length)) throw new HarnessError("INVALID_INPUT");
    if (type === "IHDR") {
      width = positiveIntegerSchema.parse(u32(data, 0));
      height = positiveIntegerSchema.parse(u32(data, 4));
      const depth = data[8], nextType = data[9], compression = data[10], filter = data[11], interlace = data[12];
      if (depth !== 8 || (nextType !== 2 && nextType !== 6) || compression !== 0 || filter !== 0 || interlace !== 0)
        throw new HarnessError("INVALID_INPUT");
      colorType = nextType;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (width === 0 || colorType < 0 || idat.length === 0) throw new HarnessError("INVALID_INPUT");
  const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idat) { compressed.set(part, cursor); cursor += part.length; }
  const inflated = await zlib(compressed, new DecompressionStream("deflate"));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  let source = 0;
  let previous: Uint8Array | null = null;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    if (filter === undefined) throw new HarnessError("INVALID_INPUT");
    const row = inflated.subarray(source + 1, source + 1 + stride);
    if (row.length !== stride) throw new HarnessError("INVALID_INPUT");
    const recon = unfilter(filter, row, previous, bpp);
    rgba.set(toRgba(recon, colorType, width), y * width * 4);
    previous = recon;
    source += 1 + stride;
  }
  if (source !== inflated.length) throw new HarnessError("INVALID_INPUT");
  return { width, height, rgba };
}
