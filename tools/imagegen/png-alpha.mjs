#!/usr/bin/env node
/**
 * 스프라이트 PNG 의 배경을 알파로 바꾼다.
 *
 * 왜 직접 쓰는가: 이 머신의 유일한 ffmpeg(playwright 번들)에는 PNG 디코더가 없어서
 * colorkey 필터를 쓸 수 없다. node:zlib 만으로 8bit RGB/RGBA 비인터레이스 PNG 를
 * 읽고 쓰는 건 충분히 짧다.
 *
 * 흰 배경: 테두리의 "거의 순백"에서만 시드하고, 연한 살색·크림은 절대 안 지운다.
 * 예전 soft=46 은 이마/콧대 하이라이트를 얼굴 구멍으로 만들었다.
 * 초록 배경: G 가 R/B 보다 뚜렷이 큰 픽셀만 지운다.
 *
 * 사용법: node tools/imagegen/png-alpha.mjs <file.png> [...] [--mode white|green] [--tol 6] [--soft 18]
 */
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("PNG 서명이 아니다");
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + length);
    chunks.push({ type, data });
    off += 12 + length;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 8bit RGB(2) / RGBA(6) 비인터레이스만 지원한다. 우리 파이프라인이 만드는 건 이 둘뿐이다. */
export function decodePng(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("IHDR 없음");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} 는 지원 안 한다`);
  if (colorType !== 2 && colorType !== 6) throw new Error(`colorType ${colorType} 는 지원 안 한다`);
  if (interlace !== 0) throw new Error("인터레이스 PNG 는 지원 안 한다");

  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = inflateSync(idat);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4, 255);
  let prev = Buffer.alloc(stride, 0);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const line = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + stride));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[x] = (line[x] + left) & 0xff; break;
        case 2: line[x] = (line[x] + up) & 0xff; break;
        case 3: line[x] = (line[x] + ((left + up) >> 1)) & 0xff; break;
        case 4: line[x] = (line[x] + paeth(left, up, upLeft)) & 0xff; break;
        default: throw new Error(`알 수 없는 필터 ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const at = y * (width * 4 + 1);
    rows[at] = 0;
    data.copy(rows, at + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 흰색과의 거리. 0 이면 순백. */
export function whiteDistance(data, index) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  return Math.max(255 - r, 255 - g, 255 - b);
}

/** 애니메 살색·크림 셔츠. 여기로는 플러드가 못 들어간다. */
export function isProtectedFill(data, index) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  if (r >= 252 && g >= 252 && b >= 250) return false;
  if (r < 168 || g < 118) return false;
  if (r + 4 < g) return false;
  if (b > g + 22) return false;
  const warmth = r - b;
  const cream = r >= 220 && g >= 200 && b >= 160 && warmth >= 8 && warmth <= 70;
  const skin = warmth >= 12 && r >= 180 && g >= 130 && r - g <= 55;
  return cream || skin;
}

/**
 * 테두리와 연결된 흰 영역만 투명하게 만든다.
 * 시드는 거의 순백(tol)만. 팽창은 soft 까지. 살색은 막는다.
 * 머리칼이 윗변에 붙어 있어도 위에서 시드하지 않는다.
 */
export function keyBorderWhite(img, tol = 6, soft = 18, options = {}) {
  const { width, height, data } = img;
  const skipTop = options.skipTop !== false;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    const idx = p * 4;
    if (isProtectedFill(data, idx)) return;
    if (whiteDistance(data, idx) > soft) return;
    visited[p] = 1;
    stack.push(p);
  };
  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = (y * width + x) * 4;
    if (isProtectedFill(data, idx)) return;
    if (whiteDistance(data, idx) > tol) return;
    push(x, y);
  };
  for (let x = 0; x < width; x += 1) {
    if (!skipTop) seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    seed(0, y);
    seed(width - 1, y);
  }
  let cleared = 0;
  while (stack.length > 0) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    const d = whiteDistance(data, p * 4);
    const alpha = d <= tol ? 0 : Math.round((255 * (d - tol)) / Math.max(1, soft - tol));
    if (alpha < data[p * 4 + 3]) {
      data[p * 4 + 3] = alpha;
      cleared += 1;
    }
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  return cleared;
}

/** 키잉 뒤에 남는 1px 흰 테두리를 밀어낸다. 살색은 건드리지 않는다. */
export function defringeWhite(img, tol = 24) {
  const { width, height, data } = img;
  const next = Buffer.from(data);
  let cleared = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;
      if (isProtectedFill(data, idx)) continue;
      if (whiteDistance(data, idx) > tol) continue;
      let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (!edge) {
        const n = [
          ((y * width + x - 1) * 4) + 3,
          ((y * width + x + 1) * 4) + 3,
          (((y - 1) * width + x) * 4) + 3,
          (((y + 1) * width + x) * 4) + 3,
        ];
        edge = n.some((a) => data[a] < 16);
      }
      if (!edge) continue;
      next[idx + 3] = 0;
      cleared += 1;
    }
  }
  next.copy(data);
  return cleared;
}

/** 크로마키 초록. 배경이 #00FF00 계열일 때 쓴다. */
export function keyChromaGreen(img, strength = 40) {
  const { width, height, data } = img;
  let cleared = 0;
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const score = g - Math.max(r, b);
    if (score < strength) continue;
    const alpha = score >= strength + 30 ? 0 : Math.round(255 * (1 - (score - strength) / 30));
    if (alpha < data[idx + 3]) {
      data[idx + 3] = alpha;
      cleared += 1;
    }
  }
  return cleared;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop());

if (isMain) {
  const mode = arg("--mode", "white");
  const tol = Number(arg("--tol", "6"));
  const soft = Number(arg("--soft", "18"));
  const files = process.argv.slice(2).filter((a) => a.endsWith(".png"));
  if (files.length === 0) {
    console.error("사용법: node tools/imagegen/png-alpha.mjs <file.png> [...] [--mode white|green] [--tol 6] [--soft 18]");
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    try {
      const img = decodePng(readFileSync(file));
      const cleared = mode === "green" ? keyChromaGreen(img) : keyBorderWhite(img, tol, soft);
      if (mode !== "green") defringeWhite(img);
      writeFileSync(file, encodePng(img));
      const pct = ((cleared / (img.width * img.height)) * 100).toFixed(1);
      console.log(`[alpha] ${file} ${img.width}x${img.height} mode=${mode} 투명 ${pct}%`);
      if (cleared === 0) {
        console.error(`[warn] ${file} 에서 지운 픽셀이 없다 — 배경이 ${mode} 가 아닐 수 있다`);
        failed += 1;
      }
    } catch (err) {
      console.error(`[fail] ${file}: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}
