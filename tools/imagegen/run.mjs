#!/usr/bin/env node
/**
 * grok CLI 로 에셋 이미지를 병렬 생성한다.
 * 사용법: node tools/imagegen/run.mjs [--only <id,...>] [--concurrency 5] [--force]
 * 스프라이트는 생성 후 ffmpeg colorkey 로 흰 배경을 알파로 뚫는다.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const GROK = process.env.GROK_BIN ?? "C:/Users/ubbio/.grok/bin/grok.exe";
const MIN_BYTES = 40000;
const CALL_TIMEOUT_MS = 8 * 60 * 1000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const only = arg("--only", null);
const concurrency = Number(arg("--concurrency", "5"));
const force = process.argv.includes("--force");

const spec = JSON.parse(readFileSync(join(HERE, "spec.json"), "utf8"));
const queue = spec.items.filter((it) => (only ? only.split(",").includes(it.id) : true));

function run(cmd, args, timeoutMs) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { cwd: ROOT, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      res({ code: -1, out, err: err + "\n[timeout]" });
    }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); res({ code: -2, out, err: String(e) }); });
    child.on("close", (code) => { clearTimeout(timer); res({ code: code ?? -3, out, err }); });
  });
}

function grokPrompt(item) {
  const abs = join(ROOT, item.out).replaceAll("\\", "/");
  return [
    `Use the image_gen tool to create exactly one illustration, then save the generated image file to ${abs} (create any missing directories first) and print the absolute path plus the file size in bytes.`,
    "",
    `Prompt for image_gen: ${item.prompt}`,
    "",
    `aspect_ratio: ${item.aspect}. Do not add any text, letters, numbers, watermark or signature to the image.`,
  ].join("\n");
}

async function keyOutWhite(absOut) {
  // playwright 번들 ffmpeg 에는 PNG 디코더가 없어서 colorkey 를 못 쓴다. 자체 키어를 쓴다.
  const r = await run(process.execPath, [join(HERE, "png-alpha.mjs"), absOut], 120000);
  if (r.code !== 0) return `알파 키잉 실패: ${(r.out + r.err).slice(-300)}`;
  return null;
}

function colorType(absOut) {
  const buf = readFileSync(absOut);
  return buf[25];
}

async function makeOne(item) {
  const abs = join(ROOT, item.out);
  mkdirSync(dirname(abs), { recursive: true });
  if (!force && existsSync(abs) && statSync(abs).size > MIN_BYTES) {
    return { id: item.id, status: "skip", bytes: statSync(abs).size, colorType: colorType(abs) };
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const r = await run(GROK, ["-p", grokPrompt(item), "--always-approve"], CALL_TIMEOUT_MS);
    if (existsSync(abs) && statSync(abs).size > MIN_BYTES) {
      if (item.key) {
        const keyErr = await keyOutWhite(abs);
        if (keyErr) return { id: item.id, status: "fail", reason: keyErr };
      }
      return { id: item.id, status: "ok", attempt, bytes: statSync(abs).size, colorType: colorType(abs) };
    }
    console.error(`[${item.id}] attempt ${attempt} produced no file (grok exit ${r.code}); tail: ${(r.out + r.err).slice(-400).replace(/\s+/g, " ")}`);
  }
  return { id: item.id, status: "fail", reason: "3회 시도 후에도 파일 없음" };
}

const results = [];
let cursor = 0;
async function worker(n) {
  while (cursor < queue.length) {
    const item = queue[cursor];
    cursor += 1;
    const started = Date.now();
    console.log(`[start] ${item.id} (worker ${n})`);
    const r = await makeOne(item);
    r.seconds = Math.round((Date.now() - started) / 1000);
    results.push(r);
    console.log(`[${r.status}] ${r.id} ${r.bytes ?? ""}b colorType=${r.colorType ?? "-"} ${r.seconds}s ${r.reason ?? ""}`);
  }
}

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, (_, i) => worker(i + 1)));

const failed = results.filter((r) => r.status === "fail");
console.log(`\nDONE ok=${results.filter((r) => r.status === "ok").length} skip=${results.filter((r) => r.status === "skip").length} fail=${failed.length}`);
for (const f of failed) console.log(`FAILED ${f.id}: ${f.reason}`);
process.exit(failed.length === 0 ? 0 : 1);
