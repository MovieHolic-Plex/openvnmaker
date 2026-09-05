#!/usr/bin/env node
/**
 * ~/.vnmaker/images 의 원본 JPEG 를 다시 PNG 로 풀고 살색 보호 키어를 친다.
 * 이미 구멍 난 public PNG 를 다시 키잉하면 얼굴이 더 사라지므로 원본에서만 한다.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const STORE = join(homedir(), ".vnmaker", "images");
const spec = JSON.parse(readFileSync(join(HERE, "spec.json"), "utf8"));

function run(cmd, args) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: ROOT, windowsHide: true });
    child.on("close", (code) => done(code ?? 1));
    child.on("error", () => done(2));
  });
}

const sprites = spec.items.filter((it) => it.key);
mkdirSync(join(ROOT, "packages/app/public/assets/sprite"), { recursive: true });

let failed = 0;
for (const item of sprites) {
  const src = join(STORE, `agy-${item.id}.jpg`);
  const dest = join(ROOT, item.out);
  if (!existsSync(src)) {
    console.error(`[miss] ${item.id} ${src}`);
    failed += 1;
    continue;
  }
  copyFileSync(src, dest);
  const conv = await run("python", [
    "-c",
    "from PIL import Image; import sys; Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[1], format='PNG')",
    dest,
  ]);
  if (conv !== 0) {
    console.error(`[fail] ${item.id} JPEG→PNG`);
    failed += 1;
    continue;
  }
  const key = await run(process.execPath, [join(HERE, "png-alpha.mjs"), dest, "--mode", "white", "--tol", "6", "--soft", "18"]);
  if (key !== 0) {
    console.error(`[fail] ${item.id} alpha`);
    failed += 1;
    continue;
  }
  console.log(`[ok] ${item.id}`);
}

writeFileSync(join(ROOT, "evidence/image/rekey.json"), JSON.stringify({ ok: sprites.length - failed, fail: failed }, null, 2));
process.exit(failed === 0 ? 0 : 1);
