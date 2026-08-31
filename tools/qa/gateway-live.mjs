#!/usr/bin/env node
/**
 * C2 + C4(게이트웨이 절반) 증거 수집기. 빌드된 게이트웨이를 띄우고 curl 로
 * 엔드포인트를 찍어 evidence/gateway/ 아래에 헤더+본문을 그대로 남긴다.
 * 조건을 못 맞추면 종료 코드 1.
 *
 *   node tools/qa/gateway-live.mjs
 *
 * 실제 계정 자격증명(~/.vnmaker/auth.json)이 있어야 C2 를 검사한다. 없으면
 * 미인증 경로만 검사하고 그 사실을 알린다.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "evidence", "gateway");
const ENTRY = join(ROOT, "packages", "gateway", "dist", "main.js");
const BASE = "http://127.0.0.1:51120";
const MIN_MODELS = 20;

const authPath = join(homedir(), ".vnmaker", "auth.json");
const hasCredentials = existsSync(authPath);

if (!existsSync(ENTRY)) {
  console.error(`빌드 산출물이 없다: ${ENTRY}\n먼저 pnpm --filter @vnmaker/gateway build 를 돌려라.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

async function alive(base = BASE) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUp(base, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !(await alive(base))) await new Promise((r) => setTimeout(r, 400));
  return alive(base);
}

function sh(cmdline) {
  return new Promise((res) => {
    const p = spawn(cmdline, { cwd: ROOT, shell: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => res({ code, out }));
  });
}

const parse = (raw) => {
  const at = raw.indexOf("\n{");
  return at < 0 ? null : JSON.parse(raw.slice(at + 1));
};

const failures = [];

// --- C2: 실제 자격증명으로 붙는다. 이미 떠 있으면 재사용한다.
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
  const status = await sh(`curl -i -s ${BASE}/api/auth/status`);
  writeFileSync(join(OUT, "curl-live.txt"), status.out, "utf8");
  const models = await sh(`curl -i -s ${BASE}/api/models`);
  writeFileSync(join(OUT, "curl-models.txt"), models.out, "utf8");

  if (!/^HTTP\/1\.1 200/m.test(status.out)) failures.push("auth/status 가 200 이 아니다");
  const s = parse(status.out);
  if (!s) failures.push("auth/status 본문을 파싱할 수 없다");

  if (!hasCredentials) {
    console.log(`자격증명이 없다 (${authPath}). C2 는 건너뛰고 미인증 경로만 검사한다.`);
    if (s?.authenticated !== false) failures.push("자격증명 없이도 authenticated 가 false 가 아니다");
  } else {
    if (s?.authenticated !== true) failures.push("authenticated 가 true 가 아니다");
    if (s?.provider !== "google-antigravity") failures.push(`provider 가 다르다: ${s?.provider}`);
    if (!s?.email) failures.push("email 이 없다");
    if (!s?.projectId) failures.push("projectId 가 없다");
    if (!(typeof s?.expires === "number" && s.expires > Date.now())) failures.push("expires 가 미래가 아니다");

    if (!/^HTTP\/1\.1 200/m.test(models.out)) failures.push("models 가 200 이 아니다");
    const mm = parse(models.out);
    const list = Array.isArray(mm?.models) ? mm.models : [];
    if (list.length < MIN_MODELS) failures.push(`모델이 ${list.length}개로 ${MIN_MODELS}개 미만이다`);
    const noQuota = list.filter((x) => typeof x?.quotaInfo?.remainingFraction !== "number");
    if (noQuota.length > 0) {
      failures.push(`quotaInfo.remainingFraction 없는 모델 ${noQuota.length}개: ${noQuota.map((x) => x.id).join(", ")}`);
    }
    writeFileSync(join(OUT, "models.json"), JSON.stringify(mm, null, 2), "utf8");
    console.log(`모델 ${list.length}개, 전부 quotaInfo.remainingFraction 보유: ${noQuota.length === 0}`);
    console.log(`provider=${s.provider} email=${s.email} projectId=${s.projectId} expiresInSeconds=${s.expiresInSeconds}`);
  }
} finally {
  if (child) child.kill();
}

// --- C4 의 게이트웨이 절반: auth.json 이 아예 없는 홈에서도 500 이 아니라 200 authenticated:false 여야 한다.
{
  const fakeHome = mkdtempSync(join(tmpdir(), "vnmaker-nohome-"));
  const port = 51130;
  const base = `http://127.0.0.1:${port}`;
  const bare = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, VNMAKER_GATEWAY_PORT: String(port) },
  });
  try {
    if (!(await waitUp(base))) {
      failures.push(`자격증명 없는 홈에서 게이트웨이가 ${port} 에 뜨지 않았다`);
    } else {
      const bareStatus = await sh(`curl -i -s ${base}/api/auth/status`);
      const bareModels = await sh(`curl -i -s ${base}/api/models`);
      writeFileSync(join(OUT, "curl-no-credentials.txt"), `${bareStatus.out}\n\n--- GET /api/models\n${bareModels.out}`, "utf8");
      if (!/^HTTP\/1\.1 200/m.test(bareStatus.out)) failures.push("자격증명 없는 홈에서 status 가 200 이 아니다");
      else if (!/"authenticated":\s*false/.test(bareStatus.out)) failures.push("자격증명 없는 홈에서 authenticated:false 가 아니다");
      else console.log("자격증명 없는 홈: status 200 authenticated:false 확인");
      if (!/^HTTP\/1\.1 401/m.test(bareModels.out)) failures.push("자격증명 없는 홈에서 models 가 401 이 아니다");
      else console.log("자격증명 없는 홈: models 401 확인");
    }
  } finally {
    bare.kill();
  }
}

if (failures.length > 0) {
  console.error("실패:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`통과. 증거: ${OUT}`);
