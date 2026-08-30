/**
 * Antigravity(Cloud Code Assist) 상수. tools/agy-login.mjs 에서 그대로 옮겼다.
 * 여기 값은 실측으로 통과한 조합이다. 바꾸면 백엔드가 조용히 신모델을 숨긴다.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const CLIENT_ID = Buffer.from(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
  "base64",
).toString("utf8");

export const CLIENT_SECRET = Buffer.from("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=", "base64").toString("utf8");

export const CALLBACK_HOST = "127.0.0.1";
export const CALLBACK_PORT = 51121;
export const CALLBACK_PATH = "/oauth-callback";

export const GATEWAY_HOST = "127.0.0.1";
export const GATEWAY_PORT = Number(process.env.VNMAKER_GATEWAY_PORT ?? 51120);

export const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
] as const;

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

/** 1차 호스트와 sandbox 폴백. 둘 다 호환성 약속이 없는 내부 표면이다. */
export const CCA_HOSTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
] as const;

export const FREE_TIER_ID = "free-tier";
export const REQUEST_TIMEOUT_MS = 30_000;
export const CALLBACK_TIMEOUT_MS = 300_000;
export const ONBOARD_TIMEOUT_MS = 30_000;
export const ONBOARD_POLL_INTERVAL_MS = 1_000;

/** loadCodeAssist / onboardUser 공통 metadata. ideType 이 게이트다. 필드를 더 넣지 마라. */
export const LOAD_CODE_ASSIST_METADATA = { ideType: "ANTIGRAVITY" } as const;

export const PROVIDER = "google-antigravity";
export const AUTH_FILE = join(homedir(), ".vnmaker", "auth.json");
export const GATEWAY_VERSION = "0.1.0";

/**
 * 백엔드가 클라이언트 버전으로 모델 게이팅을 한다. version 만 게이트이고 cl 은 검증하지 않는다.
 * 신모델이 카탈로그에서 사라지면 이 문자열을 가장 먼저 의심하라.
 */
export function antigravityUserAgent(): string {
  const version = process.env.PI_AI_ANTIGRAVITY_VERSION ?? "2.8.0";
  const cl = process.env.PI_AI_ANTIGRAVITY_CL ?? "963137146";
  const os = process.env.PI_AI_ANTIGRAVITY_OS ?? "darwin";
  const arch = process.env.PI_AI_ANTIGRAVITY_ARCH ?? "arm64";
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`;
}

export function ccaHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": antigravityUserAgent(),
  };
}
