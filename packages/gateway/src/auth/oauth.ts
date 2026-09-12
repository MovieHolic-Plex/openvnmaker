import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import open from "open";
import {
  AUTH_URL,
  CALLBACK_HOST,
  CALLBACK_PATH,
  CALLBACK_PORT,
  CALLBACK_TIMEOUT_MS,
  CLIENT_ID,
  SCOPES,
} from "../config.js";

export interface CallbackResult {
  readonly code: string;
  readonly redirectUri: string;
  /** PKCE verifier. 코드 교환 때 그대로 보낸다. */
  readonly codeVerifier: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const donePage = (ok: boolean, detail: string): string => `<!DOCTYPE html><meta charset="utf-8">
<title>vnmaker</title>
<body style="font:16px/1.6 system-ui;background:#12110e;color:#efe6d4;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center">
  <div style="font-size:15px;letter-spacing:.18em;color:${ok ? "#c9a227" : "#c45c4a"}">${ok ? "CONNECTED" : "FAILED"}</div>
  <h1 style="font-weight:600;margin:.4em 0">${ok ? "연결됐다. vnmaker 로 돌아가라." : "인증 실패"}</h1>
  <p style="color:rgba(239,230,212,.6)">${escapeHtml(detail)}</p>
</div>`;

/**
 * 브라우저를 연다. 열기에 성공하면 resolve, 못 열었거나 VNMAKER_NO_BROWSER 면 false.
 * open 패키지가 플랫폼 인용을 책임진다 — Windows 는 PowerShell Start-Process + base64
 * 인코딩이라 URL 안의 & 에 명령이 끊기지 않고, xdg-open 이 없으면 reject 로 온다.
 */
async function openBrowser(url: string): Promise<boolean> {
  if (process.env.VNMAKER_NO_BROWSER) return false;
  try {
    await open(url);
    return true;
  } catch {
    return false;
  }
}

export function authorizeUrl(redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * 루프백 콜백을 기다린다. state 16B 로 CSRF 를 막고 PKCE(S256) 로 코드 가로채기를 막는다 —
 * client_secret 은 공개 내장값이라 verifier 가 실질적인 소유 증명이다.
 * 51121 이 점유돼 있으면 임의 포트로 물러난다(구글은 루프백 포트를 검사하지 않는다).
 * onUrl 은 (url, opened) 로 부른다 — 브라우저가 안 열렸을 때만 URL 을 로그에 남기면 된다.
 */
export function waitForCallback(onUrl?: (url: string, opened: boolean) => void): Promise<CallbackResult> {
  const expectedState = randomBytes(16).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return new Promise<CallbackResult>((resolve, reject) => {
    let settled = false;
    let redirectUri = "";
    const finish = (fn: (value: never) => void, arg: unknown): void => {
      if (settled) return;
      settled = true;
      setTimeout(() => server.close(), 100);
      (fn as (value: unknown) => void)(arg);
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${CALLBACK_HOST}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end("Not Found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error");
      const detailOf = (): { ok: boolean; detail: string } => {
        if (error) return { ok: false, detail: `authorization failed: ${url.searchParams.get("error_description") ?? error}` };
        if (!code) return { ok: false, detail: "authorization code 가 없다" };
        if (state !== expectedState) return { ok: false, detail: "state 불일치 — CSRF 가능성" };
        return { ok: true, detail: "토큰을 교환하고 프로젝트를 찾는 중" };
      };
      const { ok, detail } = detailOf();
      res.writeHead(ok ? 200 : 500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(donePage(ok, detail));
      if (ok && code) finish(resolve as never, { code, redirectUri, codeVerifier });
      else if (error && state === expectedState) finish(reject as never, new Error(detail));
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EADDRINUSE") {
        finish(reject as never, err);
        return;
      }
      server.listen(0, CALLBACK_HOST);
    });

    server.once("listening", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;
      const url = authorizeUrl(redirectUri, expectedState, codeChallenge);
      void openBrowser(url).then((opened) => onUrl?.(url, opened));
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST);

    const timer = setTimeout(() => {
      finish(reject as never, new Error(`${CALLBACK_TIMEOUT_MS / 1000}초 안에 콜백이 오지 않았다`));
    }, CALLBACK_TIMEOUT_MS);
    timer.unref();
  });
}
