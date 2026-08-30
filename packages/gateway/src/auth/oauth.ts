import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { platform } from "node:os";
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
}

const donePage = (ok: boolean, detail: string): string => `<!DOCTYPE html><meta charset="utf-8">
<title>vnmaker</title>
<body style="font:16px/1.6 system-ui;background:#12110e;color:#efe6d4;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center">
  <div style="font-size:15px;letter-spacing:.18em;color:${ok ? "#c9a227" : "#c45c4a"}">${ok ? "CONNECTED" : "FAILED"}</div>
  <h1 style="font-weight:600;margin:.4em 0">${ok ? "연결됐다. vnmaker 로 돌아가라." : "인증 실패"}</h1>
  <p style="color:rgba(239,230,212,.6)">${detail}</p>
</div>`;

function openBrowser(url: string): void {
  if (process.env.VNMAKER_NO_BROWSER) return;
  try {
    if (platform() === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (platform() === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* URL 은 이미 로그로 남겼다 */
  }
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * 루프백 콜백을 기다린다. PKCE 는 쓰지 않는다 — state 16B 로 CSRF 만 막고
 * 데스크톱 클라이언트에 박힌 client_secret 으로 코드를 교환한다.
 * 51121 이 점유돼 있으면 임의 포트로 물러난다(구글은 루프백 포트를 검사하지 않는다).
 */
export function waitForCallback(onUrl?: (url: string) => void): Promise<CallbackResult> {
  const expectedState = randomBytes(16).toString("hex");
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
      if (ok && code) finish(resolve as never, { code, redirectUri });
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
      const url = authorizeUrl(redirectUri, expectedState);
      onUrl?.(url);
      openBrowser(url);
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST);

    const timer = setTimeout(() => {
      finish(reject as never, new Error(`${CALLBACK_TIMEOUT_MS / 1000}초 안에 콜백이 오지 않았다`));
    }, CALLBACK_TIMEOUT_MS);
    timer.unref();
  });
}
