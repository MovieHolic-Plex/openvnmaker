#!/usr/bin/env node
/**
 * agy 이미지 경로 실측 검사. 빌드된 게이트웨이를 띄우고 실제 계정으로
 * POST /api/image/generate 를 한 번 쳐서 PNG 가 나오는지, 저장 파일을
 * GET /api/image/file/:name 로 되받을 수 있는지 확인한다.
 *
 *   node tools/qa/image-live.mjs ["프롬프트"]
 *
 * 이 카운터는 Antigravity 데스크톱 앱과 같은 통이다. 반복 호출하면 코딩
 * 할당량이 같이 줄어든다 — CI 에 물리지 마라. 증거는 evidence/image/ 로.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "evidence", "image");
const ENTRY = join(ROOT, "packages", "gateway", "dist", "main.js");
const BASE = "http://127.0.0.1:51120";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const prompt =
  process.argv[2] ??
  "한국 대학 캠퍼스 여름 오후, 수채화 배경화. 인물 없음. 벚나무 그늘과 벽돌 강의동, 부드러운 종이 질감.";

if (!existsSync(ENTRY)) {
  console.error(`빌드 산출물이 없다: ${ENTRY}\n먼저 pnpm --filter @vnmaker/gateway build 를 돌려라.`);
  process.exit(1);
}
if (!existsSync(join(homedir(), ".vnmaker", "auth.json"))) {
  console.error("자격증명이 없다. 먼저 로그인해라: node tools/agy-login.mjs login");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const alive = async (base = BASE) => {
  try {
    return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

async function waitUp(base, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !(await alive(base))) await new Promise((r) => setTimeout(r, 400));
  return alive(base);
}

/** 특정 모델의 남은 비율. 이미지 호출 앞뒤로 찍어 같은 통을 쓴다는 걸 눈으로 본다. */
async function quotaFor(modelId) {
  try {
    const res = await fetch(`${BASE}/api/models`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const body = await res.json();
    return body.models?.find((m) => m.id === modelId)?.quotaInfo ?? null;
  } catch {
    return null;
  }
}

const failures = [];
let child = null;
if (await alive()) {
  console.log("이미 떠 있는 게이트웨이를 재사용한다.");
} else {
  child = spawn(process.execPath, [ENTRY], { cwd: ROOT, stdio: "ignore" });
  if (!(await waitUp(BASE))) {
    child.kill();
    console.error("게이트웨이가 20초 안에 뜨지 않았다.");
    process.exit(1);
  }
  console.log(`게이트웨이 기동 pid=${child.pid}`);
}

try {
  const config = await (await fetch(`${BASE}/api/image/config`)).json();
  console.log(`기본 이미지 모델: ${config.model} (허용 비율 ${config.aspectRatios.join(", ")})`);
  if (config.quotaShared !== true) failures.push("image/config 가 quotaShared 를 알려주지 않는다");

  const before = await quotaFor(config.model);
  console.log(`호출 전 remainingFraction: ${before?.remainingFraction ?? "(카탈로그에 쿼터 없음)"}`);

  const started = Date.now();
  const res = await fetch(`${BASE}/api/image/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ prompt, aspectRatio: "16:9", name: "qa-campus-16x9" }),
    signal: AbortSignal.timeout(240_000),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const text = await res.text();
  writeFileSync(join(OUT, "generate.json"), text, "utf8");

  if (res.status !== 200) {
    failures.push(`image/generate 가 ${res.status} 다: ${text.slice(0, 400)}`);
  } else {
    const body = JSON.parse(text);
    const image = body.images?.[0];
    console.log(`${elapsed}s / host=${body.host} model=${body.model} 이미지 ${body.images?.length ?? 0}장`);
    if (!image) failures.push("이미지가 0장이다");
    else {
      if (!existsSync(image.path)) failures.push(`저장 파일이 없다: ${image.path}`);
      else {
        const bytes = readFileSync(image.path);
        console.log(`저장: ${image.path} (${(bytes.byteLength / 1024).toFixed(0)} KB, ${image.mimeType})`);
        if (bytes.byteLength !== image.bytes) failures.push("응답의 bytes 와 실제 파일 크기가 다르다");
        if (image.mimeType === "image/png" && !bytes.subarray(0, 4).equals(PNG_MAGIC)) {
          failures.push("PNG 시그니처가 아니다");
        }
        if (bytes.byteLength < 10_000) failures.push(`이미지가 ${bytes.byteLength}바이트로 너무 작다`);
        writeFileSync(join(OUT, image.name), bytes);
      }
      // 저장된 파일을 게이트웨이가 되돌려주는지
      const served = await fetch(`${BASE}${image.url}`);
      if (!served.ok) failures.push(`image/file 이 ${served.status} 다`);
      else {
        const servedBytes = Buffer.from(await served.arrayBuffer());
        if (servedBytes.byteLength !== image.bytes) failures.push("서빙된 바이트 수가 저장 크기와 다르다");
        else console.log(`GET ${image.url} → ${servedBytes.byteLength} 바이트 일치`);
      }
    }
    if (body.quotaShared !== true || body.unofficial !== true) {
      failures.push("응답에 quotaShared/unofficial 경고가 빠졌다");
    }
  }

  // 경로 탈출 시도는 404 로 막혀야 한다.
  const escape = await fetch(`${BASE}/api/image/file/${encodeURIComponent("../../auth.json")}`);
  if (escape.status !== 404) failures.push(`경로 탈출이 ${escape.status} 로 응답했다 (404 여야 한다)`);
  else console.log("경로 탈출 시도 404 확인");

  const after = await quotaFor(config.model);
  console.log(`호출 후 remainingFraction: ${after?.remainingFraction ?? "(카탈로그에 쿼터 없음)"}`);
  writeFileSync(
    join(OUT, "quota.json"),
    JSON.stringify({ model: config.model, before, after, prompt, elapsedSeconds: Number(elapsed) }, null, 2),
    "utf8",
  );
} finally {
  if (child) child.kill();
}

if (failures.length > 0) {
  console.error("실패:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`통과. 증거: ${OUT}`);
