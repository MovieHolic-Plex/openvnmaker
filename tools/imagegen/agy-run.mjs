#!/usr/bin/env node
/**
 * agy(Antigravity OAuth) 로 spec.json 에셋을 뽑는다.
 * 이미지 모델은 게이트웨이 기본값(gemini-3.1-flash-image). 3.8 flash 는
 * 실측상 inlineData 를 안 준다. 코딩 할당량과 같은 통이니 한 장씩 친다.
 *
 *   node tools/imagegen/agy-run.mjs [--only id,id] [--kind bg|sprite] [--force] [--base http://127.0.0.1:5173]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const MIN_BYTES = 10_000;
const CALL_TIMEOUT_MS = 240_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const only = arg("--only", null);
const kind = arg("--kind", null);
const force = process.argv.includes("--force");
const base = arg("--base", "http://127.0.0.1:5173");
const spec = JSON.parse(readFileSync(join(HERE, "spec.json"), "utf8"));
const queue = spec.items.filter((it) => {
  if (only && !only.split(",").includes(it.id)) return false;
  if (kind === "bg") return it.id.startsWith("bg-");
  if (kind === "sprite") return it.id.startsWith("sprite-");
  return true;
});

const STYLE_LOCK =
  "Commercial Japanese visual novel game art (Key / Otomate / Prototype house style). Flat cel-shaded anime. Hard ink outlines. Large flat color regions. Everything in focus. Forbidden: watercolor, photorealism, oil paint, impressionist brush, paper texture, bokeh, depth of field, lens flare, film grain, white margins, any text, letters, numbers, watermark, signature.";

async function generate(item) {
  const prompt = `${item.prompt} ${STYLE_LOCK}`;
  const res = await fetch(`${base}/api/image/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({
      prompt,
      aspectRatio: item.aspect,
      name: `agy-${item.id}`,
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  const body = JSON.parse(text);
  const image = body.images?.[0];
  if (!image?.path) throw new Error(`이미지가 없다: ${text.slice(0, 400)}`);
  return { ...image, model: body.model, host: body.host };
}

async function keyIfNeeded(item, abs) {
  if (!item.key) return null;
  const { spawn } = await import("node:child_process");
  const code = await new Promise((resolveCode) => {
    const child = spawn(
      process.execPath,
      [join(HERE, "png-alpha.mjs"), abs, "--mode", item.keyMode === "green" ? "green" : "white", "--tol", "6", "--soft", "18"],
      { cwd: ROOT, windowsHide: true },
    );
    child.on("close", (c) => resolveCode(c ?? 1));
    child.on("error", () => resolveCode(2));
  });
  return code === 0 ? null : "알파 키잉 실패";
}

async function makeOne(item) {
  const abs = join(ROOT, item.out);
  mkdirSync(dirname(abs), { recursive: true });
  if (!force && existsSync(abs) && statSync(abs).size > MIN_BYTES) {
    return { id: item.id, status: "skip", bytes: statSync(abs).size };
  }
  const image = await generate(item);
  copyFileSync(image.path, abs);
  if (abs.toLowerCase().endsWith(".png") && image.mimeType === "image/jpeg") {
    const { spawn } = await import("node:child_process");
    const code = await new Promise((resolveCode) => {
      const child = spawn(
        "python",
        ["-c", "from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[1], format='PNG')", abs],
        { cwd: ROOT, windowsHide: true },
      );
      child.on("close", (c) => resolveCode(c ?? 1));
      child.on("error", () => resolveCode(2));
    });
    if (code !== 0) return { id: item.id, status: "fail", reason: "JPEG→PNG 변환 실패", model: image.model };
  }
  if (item.key) {
    const keyErr = await keyIfNeeded(item, abs);
    if (keyErr) return { id: item.id, status: "fail", reason: keyErr, model: image.model };
  }
  return { id: item.id, status: "ok", bytes: statSync(abs).size, model: image.model, src: image.path };
}

if (queue.length === 0) {
  console.error("뽑을 항목이 없다.");
  process.exit(1);
}

const health = await fetch(`${base}/api/image/config`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
if (!health?.ok) {
  console.error(`게이트웨이에 못 붙었다: ${base}`);
  process.exit(1);
}
const config = await health.json();
console.log(`model=${config.model} items=${queue.length} base=${base}`);

const results = [];
for (const item of queue) {
  const started = Date.now();
  console.log(`[start] ${item.id}`);
  try {
    const r = await makeOne(item);
    r.seconds = Math.round((Date.now() - started) / 1000);
    results.push(r);
    console.log(`[${r.status}] ${r.id} ${r.bytes ?? ""}b ${r.seconds}s ${r.model ?? ""} ${r.reason ?? ""}`);
  } catch (err) {
    const seconds = Math.round((Date.now() - started) / 1000);
    const reason = err instanceof Error ? err.message : String(err);
    results.push({ id: item.id, status: "fail", reason, seconds });
    console.log(`[fail] ${item.id} ${seconds}s ${reason}`);
  }
}

mkdirSync(join(ROOT, "evidence", "image"), { recursive: true });
writeFileSync(join(ROOT, "evidence", "image", "agy-run.json"), JSON.stringify({ config, results }, null, 2));

const failed = results.filter((r) => r.status === "fail");
console.log(`\nDONE ok=${results.filter((r) => r.status === "ok").length} skip=${results.filter((r) => r.status === "skip").length} fail=${failed.length}`);
for (const f of failed) console.log(`FAILED ${f.id}: ${f.reason}`);
process.exit(failed.length === 0 ? 0 : 1);
