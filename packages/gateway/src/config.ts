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

/**
 * 이미지 생성 경로도 agy 다(사용자 결정 2026-08-31). 텍스트와 같은 계정+프로젝트 카운터를
 * 쓰므로 삽화를 뽑으면 코딩 할당량이 같이 줄고, Antigravity 데스크톱 앱과도 같은 통이다.
 * 기본 모델은 실측 카탈로그에 실제로 있는 id 다 — 참조 구현의 gemini-3-pro-image 는
 * 이 계정 카탈로그에 없다. 카탈로그가 바뀌면 VNMAKER_IMAGE_MODEL 로 덮어써라.
 */
export const IMAGE_MODEL = process.env.VNMAKER_IMAGE_MODEL ?? "gemini-3.1-flash-image";
/** 이미지는 텍스트보다 훨씬 오래 걸린다. 30s 로는 못 받는다. */
export const IMAGE_TIMEOUT_MS = Number(process.env.VNMAKER_IMAGE_TIMEOUT_MS ?? 180_000);

/**
 * W1 텍스트 기본 모델. 카탈로그에 있는 id 만 쓴다.
 * `gemini-3.7-flash-low` 는 thinking 이 maxOutputTokens 를 거의 다 먹어서
 * 대사 한 글자만 남긴다(실측 thoughtsTokenCount 251 / candidatesTokenCount 1).
 * thinking 플래그가 없는 `gemini-2.5-flash` 가 한 줄용이다. 덮어쓰려면 VNMAKER_TEXT_MODEL.
 */
export const TEXT_MODEL = process.env.VNMAKER_TEXT_MODEL ?? "gemini-2.5-flash";
export const GENERATE_TIMEOUT_MS = Number(process.env.VNMAKER_GENERATE_TIMEOUT_MS ?? 90_000);
/** 한 줄만 받는다. 이 캡을 올리면 소설을 통째로 뽑아 쿼터를 태운다. */
export const GENERATE_MAX_OUTPUT_TOKENS = 512;
export const HELLO_PROMPT =
  "한국 대학 캠퍼스 여름 오후를 배경으로 한 비주얼 노벨 내레이션을 한 줄만 써라. " +
  "한글 40자에서 80자. 따옴표·제목·설명 없이 본문만. 성인 대학생 세계이고 교복과 미성년은 등장시키지 마라.";
export const IMAGE_DIR = process.env.VNMAKER_IMAGE_DIR ?? join(homedir(), ".vnmaker", "images");
export const IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

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
