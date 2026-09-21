#!/usr/bin/env node
/**
 * catalog-bgm.mjs 의 12곡을 MP3 로 굽는다 — losia 카탈로그 업로드용.
 * 내장 OST 와 같은 lamejs 파이프라인, 다른 시드 네임스페이스("catalog").
 *
 * 사용: node tools/catalog-bgm-gen.mjs <출력 디렉터리> [seed]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { seedTrack } from "./audio/random.mjs";
import { encodeMp3 } from "./audio/mp3.mjs";
import { SR } from "./audio/synth.mjs";
import { CATALOG_BGM } from "./audio/catalog-bgm.mjs";

const output = resolve(process.argv[2] ?? "catalog-bgm");
const seed = Number(process.argv[3] ?? "20260921");
mkdirSync(output, { recursive: true });

const manifest = [];
for (const [id, track] of Object.entries(CATALOG_BGM)) {
  seedTrack(seed, "catalog", id);
  const samples = track.make();
  const mp3 = encodeMp3(samples, SR, 128);
  writeFileSync(`${output}/${id}.mp3`, mp3);
  manifest.push({ id, name: track.name, tags: track.tags, desc: track.desc, seconds: samples.length / SR, bytes: mp3.length });
  console.log(`[bgm] ${id}.mp3 ${(samples.length / SR).toFixed(1)}s ${mp3.length}b`);
}
writeFileSync(`${output}/_manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`done: ${manifest.length} tracks → ${output}`);
