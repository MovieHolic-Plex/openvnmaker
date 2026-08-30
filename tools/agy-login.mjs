#!/usr/bin/env node
/**
 * Antigravity(Cloud Code Assist) OAuth 로그인 — 단독 검증 스크립트
 *
 * oh-my-pi 이식본. 원본:
 *   packages/ai/src/registry/oauth/google-antigravity.ts   (자격증명 · 스코프 · 프로젝트 발견)
 *   packages/ai/src/registry/oauth/google-oauth-shared.ts  (authorize → token 교환)
 *   packages/ai/src/registry/oauth/callback-server.ts      (루프백 콜백 서버 · state)
 *   packages/catalog/src/wire/gemini-headers.ts            (antigravity User-Agent)
 *   packages/catalog/src/discovery/antigravity.ts          (fetchAvailableModels)
 *
 * 원본은 Bun 전용 API(Bun.serve, Bun.sleep)를 쓰므로 node:http / timers로 바꿨다.
 * 의존성 없음. Node 20+ 필요(global fetch, AbortSignal.timeout).
 *
 * 주의: 비공식 어댑터다. client_id/secret은 Antigravity 데스크톱에 박혀 있는 공개 값이고
 * 커뮤니티 도구들이 그대로 쓴다. "Google 공식 연동"으로 포장하면 안 된다.
 *
 * 사용법:
 *   node tools/agy-login.mjs login     # 브라우저 동의 → 토큰 → 프로젝트 발견 → 저장
 *   node tools/agy-login.mjs status    # 저장된 자격증명 요약 (토큰 값은 안 찍는다)
 *   node tools/agy-login.mjs refresh    # refresh_token으로 access_token 재발급
 *   node tools/agy-login.mjs models    # fetchAvailableModels 로 카탈로그 확인
 */

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/* ── 상수 (원본 google-antigravity.ts 그대로) ───────────────────── */

const CLIENT_ID = Buffer.from(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
  "base64",
).toString("utf8");
const CLIENT_SECRET = Buffer.from("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=", "base64").toString("utf8");

const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const CALLBACK_HOST = "127.0.0.1";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

const CCA_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_URL = `${CCA_ENDPOINT}/v1internal:loadCodeAssist`;
const ONBOARD_USER_URL = `${CCA_ENDPOINT}/v1internal:onboardUser`;
const OPERATIONS_URL = `${CCA_ENDPOINT}/v1internal`;
const FETCH_MODELS_URL = `${CCA_ENDPOINT}/v1internal:fetchAvailableModels`;

const FREE_TIER_ID = "free-tier";
const ONBOARD_TIMEOUT_MS = 30_000;
const ONBOARD_POLL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;
const CALLBACK_TIMEOUT_MS = 300_000;

/** 원본은 loadCodeAssist/onboardUser에 이 metadata를 붙인다. ideType이 게이트다. */
const LOAD_CODE_ASSIST_METADATA = { ideType: "ANTIGRAVITY" };

const AUTH_FILE = join(homedir(), ".vnmaker", "auth.json");
const PROVIDER = "google-antigravity";

/** 백엔드가 클라이언트 버전으로 모델 게이팅을 한다. os/arch/cl은 캡처값 고정. */
function antigravityUserAgent() {
  const version = process.env.PI_AI_ANTIGRAVITY_VERSION || "2.8.0";
  const cl = process.env.PI_AI_ANTIGRAVITY_CL || "963137146";
  const os = process.env.PI_AI_ANTIGRAVITY_OS || "darwin";
  const arch = process.env.PI_AI_ANTIGRAVITY_ARCH || "arm64";
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`;
}

/* ── 작은 유틸 ──────────────────────────────────────────────── */

const log = (msg) => process.stderr.write(`${msg}\n`);

function fail(msg) {
  log(`\n✖ ${msg}`);
  process.exit(1);
}

async function jsonFetch(label, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError") throw new Error(`${label}: ${timeoutMs}ms 안에 응답 없음 (${url})`);
    throw new Error(`${label}: ${err?.message ?? err}`);
  }
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`${label} 실패: ${res.status} ${res.statusText}\n${text.slice(0, 1200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: JSON 파싱 실패\n${text.slice(0, 400)}`);
  }
}

function ccaHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": antigravityUserAgent(),
  };
}

/* ── 자격증명 저장소 (~/.vnmaker/auth.json) ─────────────────── */

async function readStore() {
  try {
    return JSON.parse(await readFile(AUTH_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeCreds(creds) {
  const store = await readStore();
  store[PROVIDER] = creds;
  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await writeFile(AUTH_FILE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    await chmod(AUTH_FILE, 0o600);
  } catch {
    /* Windows에서는 무의미 — 아래 경고로 대체 */
  }
  log(`\n✔ 저장: ${AUTH_FILE}`);
  if (platform() === "win32") {
    log("  (Windows에서는 0600이 적용되지 않는다. 리프레시 토큰이 평문으로 있으니 폴더 ACL을 확인할 것)");
  }
}

async function loadCreds() {
  const creds = (await readStore())[PROVIDER];
  if (!creds?.refresh) fail(`저장된 자격증명이 없다. 먼저 실행: node tools/agy-login.mjs login`);
  return creds;
}

/* ── 1) 루프백 콜백 서버 ────────────────────────────────────── */

const DONE_HTML = (ok, detail) => `<!DOCTYPE html><meta charset="utf-8">
<title>vnmaker</title>
<body style="font:16px/1.6 system-ui;background:#12110e;color:#efe6d4;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center">
  <div style="font-size:15px;letter-spacing:.18em;color:${ok ? "#c9a227" : "#c45c4a"}">${ok ? "CONNECTED" : "FAILED"}</div>
  <h1 style="font-weight:600;margin:.4em 0">${ok ? "연결됐다. 터미널로 돌아가라." : "인증 실패"}</h1>
  <p style="color:rgba(239,230,212,.6)">${detail}</p>
</div>`;

/**
 * 콜백을 기다린다. 51121이 막혀 있으면 임의 포트로 물러난다(원본과 동일 정책).
 * Google은 루프백 리다이렉트의 포트를 검사하지 않으므로 물러나도 동작한다.
 */
function waitForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      setTimeout(() => server.close(), 100);
      fn(arg);
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://${CALLBACK_HOST}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end("Not Found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description") ?? error;

      let ok = false;
      let detail = "";
      if (error) {
        detail = `authorization failed: ${errorDescription}`;
      } else if (!code) {
        detail = "authorization code가 없다";
      } else if (state !== expectedState) {
        detail = "state 불일치 — CSRF 가능성";
      } else {
        ok = true;
        detail = "토큰을 교환하고 프로젝트를 찾는 중";
      }

      res.writeHead(ok ? 200 : 500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DONE_HTML(ok, detail));

      // state가 우리 것인 error는 즉시 실패로 올린다(사용자가 동의 거부한 경우).
      // state 없는 error는 로컬 프로세스가 위조할 수 있으므로 무시한다.
      if (ok) finish(resolve, { code, redirectUri: server.redirectUri });
      else if (error && state === expectedState) finish(reject, new Error(detail));
    });

    server.on("error", (err) => {
      if (err.code !== "EADDRINUSE") return finish(reject, err);
      log(`  포트 ${CALLBACK_PORT}가 사용 중 — 임의 포트로 물러난다`);
      server.listen(0, CALLBACK_HOST);
    });

    server.once("listening", () => {
      const { port } = server.address();
      const redirectUri = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;
      const authUrl = `${AUTH_URL}?${new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES.join(" "),
        state: expectedState,
        access_type: "offline",
        prompt: "consent",
      })}`;

      server.redirectUri = redirectUri; // token 교환 때 같은 값을 보내야 한다
      log(`\n브라우저에서 Google 동의를 마쳐라. 콜백: ${redirectUri}`);
      log(`\n브라우저가 안 열리면 이 URL을 직접 열어라:\n${authUrl}\n`);
      openBrowser(authUrl);
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST);

    const timer = setTimeout(() => {
      finish(reject, new Error(`${CALLBACK_TIMEOUT_MS / 1000}초 안에 콜백이 오지 않았다`));
    }, CALLBACK_TIMEOUT_MS);
    timer.unref?.();
  });
}

/** 원격/헤드리스에서는 브라우저를 여기서 열 수 없다. URL을 복사해 노트북에서 열어라. */
function openBrowser(url) {
  if (process.env.VNMAKER_NO_BROWSER) return;
  try {
    if (platform() === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform() === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* URL을 이미 출력했으므로 무시 */
  }
}

/* ── 2) 토큰 교환 ───────────────────────────────────────────── */

async function exchangeCode(code, redirectUri) {
  const data = await jsonFetch("token 교환", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!data.refresh_token) {
    throw new Error("refresh_token이 안 왔다. prompt=consent로 다시 시도해야 한다");
  }
  return data;
}

async function refreshAccessToken(refreshToken) {
  return jsonFetch("token refresh", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
}

async function getEmail(accessToken) {
  try {
    const data = await jsonFetch("userinfo", USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    return data.email;
  } catch {
    return undefined; // 이메일은 선택 항목
  }
}

/* ── 3) Cloud Code Assist 프로젝트 발견 ─────────────────────── */

async function postLoadCodeAssist(accessToken, body) {
  return jsonFetch("loadCodeAssist", LOAD_CODE_ASSIST_URL, {
    method: "POST",
    headers: ccaHeaders(accessToken),
    body: JSON.stringify(body),
  });
}

async function loadCodeAssist(accessToken) {
  let payload = await postLoadCodeAssist(accessToken, { metadata: LOAD_CODE_ASSIST_METADATA });
  const projectId = payload.cloudaicompanionProject;
  // paidTier가 없고 프로젝트는 있으면, 그 프로젝트를 명시해 한 번 더 부른다(원본 동작).
  if (payload.paidTier == null && projectId) {
    payload = await postLoadCodeAssist(accessToken, {
      cloudaicompanionProject: projectId,
      metadata: LOAD_CODE_ASSIST_METADATA,
    });
  }
  return payload;
}

function assertFreeTierEligible(payload) {
  if (payload.allowedTiers?.some((t) => t.id === FREE_TIER_ID)) return;
  const tier = payload.ineligibleTiers?.find((t) => t.tierId === FREE_TIER_ID);
  if (!tier?.reasonMessage) return; // 판단 불가면 통과시키고 뒤에서 실패하게 둔다
  throw new Error(`${tier.reasonMessage}${tier.validationUrl ? `\n${tier.validationUrl}` : ""}`);
}

async function onboardUser(accessToken) {
  const deadline = Date.now() + ONBOARD_TIMEOUT_MS;
  const remaining = () => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`onboardUser가 ${ONBOARD_TIMEOUT_MS}ms 안에 안 끝났다`);
    return left;
  };

  let op = await jsonFetch(
    "onboardUser",
    ONBOARD_USER_URL,
    {
      method: "POST",
      headers: ccaHeaders(accessToken),
      body: JSON.stringify({ tierId: FREE_TIER_ID, metadata: LOAD_CODE_ASSIST_METADATA }),
    },
    remaining(),
  );

  while (op.done !== true) {
    await sleep(Math.min(ONBOARD_POLL_INTERVAL_MS, remaining()));
    if (!op.name) throw new Error("onboardUser가 operation name 없이 응답했다");
    op = await jsonFetch(
      "onboardUser operation",
      `${OPERATIONS_URL}/${op.name}`,
      { method: "GET", headers: ccaHeaders(accessToken) },
      remaining(),
    );
  }
  if (op.error) throw new Error(`onboardUser 실패: ${op.error.code ?? ""} ${op.error.message ?? ""}`.trim());
  if (!op.response) throw new Error("OnboardUserResponse가 비어 있다");
}

async function discoverProject(accessToken) {
  log("  · Cloud Code Assist 계정 상태 확인");
  const initial = await loadCodeAssist(accessToken);
  assertFreeTierEligible(initial);

  if (initial.currentTier == null) {
    log("  · free tier 프로비저닝 (onboardUser)");
    await onboardUser(accessToken);
  } else {
    log(`  · 이미 tier 있음: ${initial.currentTier?.id ?? "(id 없음)"}`);
  }

  log("  · 프로젝트 재조회");
  const refreshed = await loadCodeAssist(accessToken);
  const projectId = refreshed.cloudaicompanionProject;
  if (!projectId) throw new Error("loadCodeAssist가 cloudaicompanionProject를 주지 않았다");
  return projectId;
}

/* ── 명령 ───────────────────────────────────────────────────── */

async function cmdLogin() {
  log("Antigravity OAuth 로그인 (oh-my-pi 이식본)");
  const state = randomBytes(16).toString("hex");

  const { code, redirectUri } = await waitForCallback(state);

  log("\n· authorization code 수신 → 토큰 교환");
  const token = await exchangeCode(code, redirectUri);

  const email = await getEmail(token.access_token);
  if (email) log(`· 계정: ${email}`);

  log("· 프로젝트 발견");
  const projectId = await discoverProject(token.access_token);
  log(`· cloudaicompanionProject: ${projectId}`);

  await writeCreds({
    refresh: token.refresh_token,
    access: token.access_token,
    expires: Date.now() + token.expires_in * 1000 - 5 * 60 * 1000,
    projectId,
    email,
  });
  log("\n다음: node tools/agy-login.mjs models");
}

async function cmdStatus() {
  const c = await loadCreds();
  const left = Math.round((c.expires - Date.now()) / 1000);
  log(`provider   ${PROVIDER}`);
  log(`email      ${c.email ?? "(없음)"}`);
  log(`project    ${c.projectId ?? "(없음)"}`);
  log(`access     ${c.access ? `있음 (${c.access.length}자)` : "없음"}, 만료까지 ${left}s${left <= 0 ? " — 갱신 필요" : ""}`);
  log(`refresh    ${c.refresh ? `있음 (${c.refresh.length}자)` : "없음"}`);
  log(`file       ${AUTH_FILE}`);
}

async function cmdRefresh() {
  const c = await loadCreds();
  const data = await refreshAccessToken(c.refresh);
  await writeCreds({
    ...c,
    refresh: data.refresh_token || c.refresh,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  });
  log(`access_token 재발급 완료 — ${data.expires_in}s 유효`);
}

async function cmdModels() {
  let c = await loadCreds();
  if (c.expires <= Date.now()) {
    log("access_token 만료 — 먼저 갱신한다");
    await cmdRefresh();
    c = await loadCreds();
  }
  const data = await jsonFetch("fetchAvailableModels", FETCH_MODELS_URL, {
    method: "POST",
    headers: ccaHeaders(c.access),
    body: JSON.stringify({}),
  });
  const models = data.models ?? {};
  const ids = Object.keys(models);
  if (ids.length === 0) {
    log("모델 목록이 비어 있다. 계정에 Antigravity 권한이 없을 수 있다(403이면 특히).");
    return;
  }
  log(`모델 ${ids.length}개:`);
  for (const id of ids.sort()) {
    const m = models[id];
    const flags = [
      m.modelProvider ?? m.apiProvider,
      m.supportsThinking ? "thinking" : null,
      m.supportsImages ? "images" : null,
      m.recommended ? "recommended" : null,
    ].filter(Boolean);
    log(`  ${id.padEnd(34)} ${flags.join(" · ")}`);
  }
}

const commands = { login: cmdLogin, status: cmdStatus, refresh: cmdRefresh, models: cmdModels };
const cmd = process.argv[2] ?? "login";
const run = commands[cmd];
if (!run) fail(`알 수 없는 명령: ${cmd}\n사용 가능: ${Object.keys(commands).join(", ")}`);

try {
  await run();
} catch (err) {
  fail(err?.message ?? String(err));
}
