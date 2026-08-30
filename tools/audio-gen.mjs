#!/usr/bin/env node
/**
 * OST 5곡 + 효과음 10종을 합성해 MP3 로 굽는다.
 * 이 머신에는 오디오 인코더가 있는 ffmpeg 이 없다(playwright 번들은 png/libvpx 뿐).
 * 그래서 순수 JS 인코더 lamejs 를 쓴다.
 *
 * 사용법: node tools/audio-gen.mjs [--only <id,...>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeMp3 } from "./audio/mp3.mjs";
import { SR } from "./audio/synth.mjs";
import { BGM, SFX } from "./audio/tracks.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BGM_DIR = join(ROOT, "packages/app/public/assets/audio/bgm");
const SFX_DIR = join(ROOT, "packages/app/public/assets/audio/sfx");
const KBPS = 128;

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg === -1 ? null : new Set((process.argv[onlyArg + 1] ?? "").split(","));

mkdirSync(BGM_DIR, { recursive: true });
mkdirSync(SFX_DIR, { recursive: true });

let made = 0;
for (const [id, make] of Object.entries(BGM)) {
  if (only && !only.has(id)) continue;
  const started = Date.now();
  const samples = make();
  const mp3 = encodeMp3(samples, SR, KBPS);
  writeFileSync(join(BGM_DIR, `${id}.mp3`), mp3);
  console.log(`[bgm] ${id}.mp3 ${(samples.length / SR).toFixed(1)}s ${mp3.length}b ${Date.now() - started}ms`);
  made += 1;
}

for (const [id, make] of Object.entries(SFX)) {
  if (only && !only.has(id)) continue;
  const samples = make();
  const mp3 = encodeMp3(samples, SR, KBPS);
  writeFileSync(join(SFX_DIR, `${id}.mp3`), mp3);
  console.log(`[sfx] ${id}.mp3 ${(samples.length / SR).toFixed(2)}s ${mp3.length}b`);
  made += 1;
}

console.log(`\nDONE ${made} 파일`);
