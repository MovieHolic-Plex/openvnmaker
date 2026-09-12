#!/usr/bin/env node
/**
 * W1 텍스트 경로 실측. 빌드된 게이트웨이를 띄워 POST /api/generate 한 방을 친다.
 *
 *   node tools/qa/generate-live.mjs
 *
 * 코딩 할당량과 같은 통이다. CI 에 물리지 마라.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "evidence", "generate");
const ENTRY = join(ROOT, "packages", "gateway", "dist", "main.js");
const BASE = "http://127.0.0.1:51120";

if (!existsSync(ENTRY)) {
  console.error(`빌드 산출물이 없다: ${ENTRY}\n먼저 pnpm --filter @vnmaker/gateway build 를 돌려라.`);
  process.exit(1);
}
if (!existsSync(join(homedir(), ".vnmaker", "auth.json"))) {
  console.error("자격증명이 없다. 먼저 로그인해라: node tools/agy-login.mjs login");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const alive = async () => {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

async function waitUp(ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !(await alive())) await new Promise((r) => setTimeout(r, 400));
  return alive();
}

const failures = [];
let child = null;
if (await alive()) {
  console.log("이미 떠 있는 게이트웨이를 재사용한다.");
} else {
  child = spawn(process.execPath, [ENTRY], { cwd: ROOT, stdio: "ignore" });
  if (!(await waitUp())) {
    child.kill();
    console.error("게이트웨이가 20초 안에 뜨지 않았다.");
    process.exit(1);
  }
  console.log(`게이트웨이 기동 pid=${child.pid}`);
}

try {
  const config = await (await fetch(`${BASE}/api/generate/config`)).json();
  console.log(`기본 텍스트 모델: ${config.model}`);
  const started = Date.now();
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(120_000),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const text = await res.text();
  writeFileSync(join(OUT, "generate.json"), text, "utf8");
  if (res.status !== 200) {
    failures.push(`generate 가 ${res.status} 다: ${text.slice(0, 400)}`);
  } else {
    const body = JSON.parse(text);
    console.log(`${elapsed}s / host=${body.host} model=${body.model} chars=${body.text?.length ?? 0}`);
    console.log(body.text);
    if (typeof body.text !== "string" || body.text.trim() === "") failures.push("텍스트가 비었다");
    if (body.quotaShared !== true || body.unofficial !== true) failures.push("경고 플래그가 빠졌다");
  }
} finally {
  if (child) child.kill();
}

if (failures.length > 0) {
  console.error("실패:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`통과. 증거: ${OUT}`);
