import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

/** Deliberately tiny geometric test images, not AI artwork. */
export function syntheticPng(index: number, alpha = false): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  // RGBA: transparent red, solid green, half-alpha blue, index-coded pixel.
  const pixels = Buffer.from([0, 255, 0, 0, alpha ? 0 : 255, 0, 255, 0, 255,
    0, 0, 0, 255, alpha ? 128 : 255, index, 64, 128, 255]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(kind: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(kind, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/** One millisecond of deterministic PCM, intentionally not a soundtrack. */
export function syntheticWav(index: number): Buffer {
  const wav = Buffer.alloc(60);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(52, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(16, 40);
  for (let sample = 0; sample < 8; sample++) wav.writeInt16LE((index + 1) * (sample % 2 ? 100 : -100), 44 + sample * 2);
  return wav;
}

export const byteHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const artUrl = (index: number): string => `/assets/synthetic/art-${String(index).padStart(3, "0")}.png`;
export const audioUrl = (index: number): string => `/assets/user/${byteHash(syntheticWav(index))}.wav`;

export function mediaInventory() {
  return [
    ...Array.from({ length: 120 }, (_, index) => {
      const bytes = syntheticPng(index, index >= 80);
      return { kind: "artwork", path: artUrl(index).slice(1), hash: byteHash(bytes), bytes } as const;
    }),
    ...Array.from({ length: 20 }, (_, index) => {
      const bytes = syntheticWav(index);
      return { kind: "audio", path: audioUrl(index).slice(1), hash: byteHash(bytes), bytes } as const;
    }),
  ];
}
