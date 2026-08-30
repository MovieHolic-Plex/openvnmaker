#!/usr/bin/env node
/**
 * 스프라이트 PNG 의 흰 배경을 알파로 바꾼다.
 *
 * 왜 직접 쓰는가: 이 머신의 유일한 ffmpeg(playwright 번들)에는 PNG 디코더가 없어서
 * colorkey 필터를 쓸 수 없다. node:zlib 만으로 8bit RGB/RGBA 비인터레이스 PNG 를
 * 읽고 쓰는 건 충분히 짧다.
 *
 * 키잉 방식: 화면 테두리에서 시작해 "거의 흰색" 픽셀을 4방향 플러드필로 따라간다.
 * 바깥과 연결된 흰색만 지우므로 셔츠 하이라이트 같은 내부 흰색은 살아남는다.
 * 경계에서는 흰색과의 거리로 알파를 램프해 수채화 번짐을 보존한다.
 *
 * 사용법: node tools/imagegen/png-alpha.mjs <file.png> [...] [--tol 10] [--soft 46]
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
function whiteDistance(data, index) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  return Math.max(255 - r, 255 - g, 255 - b);
}

/**
 * 테두리와 연결된 흰 영역만 투명하게 만든다.
 * tol 이하면 완전 투명, soft 까지는 선형 램프, 그 위는 그대로 둔다.
 */
export function keyBorderWhite(img, tol = 10, soft = 46) {
  const { width, height, data } = img;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    if (whiteDistance(data, p * 4) > soft) return;
    visited[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  let cleared = 0;
  while (stack.length > 0) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    const d = whiteDistance(data, p * 4);
    const alpha = d <= tol ? 0 : Math.round((255 * (d - tol)) / (soft - tol));
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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop());

if (isMain) {
  const tol = arg("--tol", 10);
  const soft = arg("--soft", 46);
  const files = process.argv.slice(2).filter((a) => a.endsWith(".png"));
  if (files.length === 0) {
    console.error("사용법: node tools/imagegen/png-alpha.mjs <file.png> [...] [--tol 10] [--soft 46]");
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    try {
      const img = decodePng(readFileSync(file));
      const cleared = keyBorderWhite(img, tol, soft);
      writeFileSync(file, encodePng(img));
      const pct = ((cleared / (img.width * img.height)) * 100).toFixed(1);
      console.log(`[alpha] ${file} ${img.width}x${img.height} 투명 ${pct}%`);
      if (cleared === 0) {
        console.error(`[warn] ${file} 에서 지운 픽셀이 없다 — 배경이 흰색이 아닐 수 있다`);
        failed += 1;
      }
    } catch (err) {
      console.error(`[fail] ${file}: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}
