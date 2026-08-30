#!/usr/bin/env node
/**
 * 생성된 MP3 의 MPEG 프레임 헤더를 실제로 파싱해 재생 길이를 재고 범위를 검사한다.
 * 파일 크기만 보는 검사는 "파일이 있다"만 증명한다.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "packages/app/public/assets/audio");

const EXPECTED = {
  "bgm/main-theme.mp3": [45, 90],
  "bgm/daily.mp3": [45, 90],
  "bgm/rain.mp3": [45, 90],
  "bgm/warm.mp3": [45, 90],
  "bgm/ending.mp3": [45, 90],
  "sfx/ui-click.mp3": [0.05, 0.4],
  "sfx/ui-hover.mp3": [0.04, 0.4],
  "sfx/page-turn.mp3": [0.3, 1.0],
  "sfx/door-open.mp3": [0.6, 1.6],
  "sfx/footsteps.mp3": [1.4, 2.8],
  "sfx/rain-loop.mp3": [5.5, 9.0],
  "sfx/cicada.mp3": [4.5, 8.0],
  "sfx/phone-buzz.mp3": [0.7, 1.6],
  "sfx/brush-stroke.mp3": [0.3, 0.9],
  "sfx/heartbeat.mp3": [1.5, 2.8],
};

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const RATES_V1 = [44100, 48000, 32000, 0];

/** 프레임을 하나씩 걸어 실제 샘플 수를 센다. */
function mp3Duration(buf) {
  let off = 0;
  if (buf.toString("latin1", 0, 3) === "ID3") {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    off = 10 + size;
  }
  let samples = 0;
  let rate = 0;
  let frames = 0;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) {
      off += 1;
      continue;
    }
    const version = (buf[off + 1] >> 3) & 0x03;
    const layer = (buf[off + 1] >> 1) & 0x03;
    const bitrateIndex = (buf[off + 2] >> 4) & 0x0f;
    const rateIndex = (buf[off + 2] >> 2) & 0x03;
    const padding = (buf[off + 2] >> 1) & 0x01;
    if (version !== 3 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      off += 1;
      continue;
    }
    const bitrate = BITRATES_V1_L3[bitrateIndex] * 1000;
    rate = RATES_V1[rateIndex];
    const frameLength = Math.floor((144 * bitrate) / rate) + padding;
    if (frameLength <= 0) break;
    samples += 1152;
    frames += 1;
    off += frameLength;
  }
  return { seconds: rate === 0 ? 0 : samples / rate, frames };
}

let failed = 0;
for (const [rel, [min, max]] of Object.entries(EXPECTED)) {
  const path = join(ASSETS, rel);
  if (!existsSync(path)) {
    console.log(`${rel} MISSING`);
    failed += 1;
    continue;
  }
  const buf = readFileSync(path);
  const { seconds, frames } = mp3Duration(buf);
  const ok = seconds >= min && seconds <= max && frames > 0;
  console.log(`${rel} ${seconds.toFixed(2)}s ${buf.length}b frames=${frames} ${ok ? "OK" : `OUT_OF_RANGE(${min}..${max})`}`);
  if (!ok) failed += 1;
}

console.log(`\n${Object.keys(EXPECTED).length - failed}/${Object.keys(EXPECTED).length} 통과`);
process.exit(failed === 0 ? 0 : 1);
