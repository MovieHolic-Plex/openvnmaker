#!/usr/bin/env node
/**
 * OST 5곡 + 효과음 10종을 합성해 MP3 로 굽는다.
 * 이 머신에는 오디오 인코더가 있는 ffmpeg 이 없다(playwright 번들은 png/libvpx 뿐).
 * 그래서 순수 JS 인코더 lamejs 를 쓴다.
 *
 * 사용법: node tools/audio-gen.mjs [--only <id,...>] [--output <directory>] [--seed <uint32>]
 * --output 생략 시 앱의 음원을 교체한다. 기존 릴리스 검증은 별도 폴더를 사용할 것.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { seedTrack } from "./audio/random.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeMp3 } from "./audio/mp3.mjs";
import { SR } from "./audio/synth.mjs";
import { BGM, SFX } from "./audio/tracks.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!["--output", "--seed", "--only"].includes(key) || options.has(key) || !value || value.startsWith("--")) throw new Error("Usage: node tools/audio-gen.mjs [--output directory] [--seed uint32] [--only id,id]");
  options.set(key, value);
}
const seed = Number(options.get("--seed") ?? "20260906");
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be a uint32.");
const output = options.has("--output") ? resolve(options.get("--output")) : join(ROOT, "packages/app/public/assets/audio");
const BGM_DIR = join(output, "bgm");
const SFX_DIR = join(output, "sfx");
const KBPS = 128;

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg === -1 ? null : new Set((process.argv[onlyArg + 1] ?? "").split(","));
const known = new Set([...Object.keys(BGM), ...Object.keys(SFX)]);
if (only && [...only].some(id => !known.has(id))) throw new Error("Unknown audio track in --only.");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = ["tools/audio-gen.mjs", "tools/audio/mp3.mjs", "tools/audio/synth.mjs", "tools/audio/tracks.mjs", "tools/audio/random.mjs"];
const sources = sourceFiles.map(path => ({ path, sha256: hash(readFileSync(join(ROOT, path))) }));
const files = [];

mkdirSync(BGM_DIR, { recursive: true });
mkdirSync(SFX_DIR, { recursive: true });

let made = 0;
for (const [id, make] of Object.entries(BGM)) {
  if (only && !only.has(id)) continue;
  const started = Date.now();
  seedTrack(seed, "bgm", id);
  const samples = make();
  const mp3 = encodeMp3(samples, SR, KBPS);
  writeFileSync(join(BGM_DIR, `${id}.mp3`), mp3);
  files.push({ path: `bgm/${id}.mp3`, samples: samples.length, bytes: mp3.length, sha256: hash(mp3) });
  console.log(`[bgm] ${id}.mp3 ${(samples.length / SR).toFixed(1)}s ${mp3.length}b ${Date.now() - started}ms`);
  made += 1;
}

for (const [id, make] of Object.entries(SFX)) {
  if (only && !only.has(id)) continue;
  seedTrack(seed, "sfx", id);
  const samples = make();
  const mp3 = encodeMp3(samples, SR, KBPS);
  writeFileSync(join(SFX_DIR, `${id}.mp3`), mp3);
  files.push({ path: `sfx/${id}.mp3`, samples: samples.length, bytes: mp3.length, sha256: hash(mp3) });
  console.log(`[sfx] ${id}.mp3 ${(samples.length / SR).toFixed(2)}s ${mp3.length}b`);
  made += 1;
}

console.log(`\nDONE ${made} 파일`);
if (sources.some(source => source.sha256 !== hash(readFileSync(join(ROOT, source.path))))) throw new Error("Generator source changed during rendering; no generation record written. Rerun from a stable checkout.");
const require = createRequire(import.meta.url);
const encoder = JSON.parse(readFileSync(require.resolve("lamejs/package.json"), "utf8"));
// Partial runs describe only generated files, never stale directory contents.
writeFileSync(join(output, "generation.json"), JSON.stringify({ version: 1, method: "procedural-synthesis", seed, sampleRate: SR, channels: 1, kbps: KBPS, node: process.version, v8: process.versions.v8, encoder: { name: encoder.name, version: encoder.version, bundleSha256: hash(readFileSync(require.resolve("lamejs/lame.min.js"))) }, sources, files }, null, 2));
