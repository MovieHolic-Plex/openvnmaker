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
 * 기본 모델은 실측 카탈로그에 있는 전용 이미지 id 다. gemini-3.8-flash-* 는
 * supportsImages 가 켜져 있어도 입력 비전이고, IMAGE 모달리티로는 바이트가 안 온다
 * (2026-09-04: aspectRatio 있으면 400, 없으면 텍스트만). 카탈로그에 3.8-flash-image 는 없다.
 */
export const IMAGE_MODEL = process.env.VNMAKER_IMAGE_MODEL ?? "gemini-3.1-flash-image";
/** 이미지는 텍스트보다 훨씬 오래 걸린다. 30s 로는 못 받는다. */
export const IMAGE_TIMEOUT_MS = Number(process.env.VNMAKER_IMAGE_TIMEOUT_MS ?? 180_000);

/**
 * 텍스트/에이전트 기본 모델. agy 카탈로그의 3.8 flash 노력 라우팅 id.
 * high = thinking HIGH. 장편 초안을 한 방에 뽑기 위해 출력 한도는 40k.
 * 덮어쓰려면 VNMAKER_TEXT_MODEL.
 */
export const TEXT_MODEL = process.env.VNMAKER_TEXT_MODEL ?? "gemini-3.8-flash-high";
export const GENERATE_TIMEOUT_MS = Number(process.env.VNMAKER_GENERATE_TIMEOUT_MS ?? 600_000);
export const GENERATE_PROMPT_MAX = Number(process.env.VNMAKER_GENERATE_PROMPT_MAX ?? 16_000);
export const GENERATE_MAX_OUTPUT_TOKENS = Number(process.env.VNMAKER_GENERATE_MAX_OUTPUT_TOKENS ?? 40_000);
export const AGENT_MAX_OUTPUT_TOKENS = Number(process.env.VNMAKER_AGENT_MAX_OUTPUT_TOKENS ?? 40_000);
export const TEXT_THINKING_CONFIG = { includeThoughts: false, thinkingLevel: "HIGH" } as const;
export const AGENT_MAX_TOOL_CALLS = 12;
export const HELLO_PROMPT =
  "한국 대학 캠퍼스 여름 오후를 배경으로 한 비주얼 노벨 내레이션을 한 줄만 써라. " +
  "한글 40자에서 80자. 따옴표·제목·설명 없이 본문만. 성인 대학생 세계이고 교복과 미성년은 등장시키지 마라.";
export const IMAGE_DIR = process.env.VNMAKER_IMAGE_DIR ?? join(homedir(), ".vnmaker", "images");
export const IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
/** imageConfig.imageSize 허용값. 임의 문자열 패스스루는 업스트림 400 이나 쿼터 낭비만 부른다. */
export const IMAGE_SIZES = ["1K", "2K", "4K"] as const;

/**
 * 이미지 백엔드 선택. 기본은 codex — 로컬 `codex exec` 가 내장 image-generation
 * 스킬로 그린다(사용자 결정 2026-09-12: 그림 품질이 agy 보다 낫다). "agy" 로 돌리면
 * 예전 Antigravity IMAGE 모달리티 경로가 살아난다. 요청마다 읽어야 테스트가 뒤집을 수 있다.
 */
export type ImageBackend = "codex" | "agy";
export function imageBackend(): ImageBackend {
  return process.env.VNMAKER_IMAGE_BACKEND === "agy" ? "agy" : "codex";
}

export const CODEX_BIN = process.env.VNMAKER_CODEX_BIN ?? "codex";
/** codex 의 홈. auth.json·generated_images·config.toml 이 여기 산다. */
export const CODEX_HOME_DIR = process.env.CODEX_HOME ?? join(homedir(), ".codex");
/** codex exec 의 작업 디렉터리. git repo 가 아니므로 --skip-git-repo-check 와 짝이다. */
export const CODEX_WORK_DIR = process.env.VNMAKER_CODEX_WORK_DIR ?? join(homedir(), ".vnmaker", "codex-work");
/** 이미지 스킬이 PNG 를 떨구는 곳. 세션 id 디렉터리 아래 exec-*.png 로 쌓인다. */
export const CODEX_IMAGES_DIR = join(CODEX_HOME_DIR, "generated_images");
/** 에이전트 기동+생성까지 넉넉히. 사용자 실측은 장당 1~2분대였다. */
export const CODEX_IMAGE_TIMEOUT_MS = Number(process.env.VNMAKER_CODEX_IMAGE_TIMEOUT_MS ?? 300_000);

export const CALLBACK_TIMEOUT_MS = 300_000;
export const ONBOARD_TIMEOUT_MS = 30_000;
export const ONBOARD_POLL_INTERVAL_MS = 1_000;

/** loadCodeAssist / onboardUser 공통 metadata. ideType 이 게이트다. 필드를 더 넣지 마라. */
export const LOAD_CODE_ASSIST_METADATA = { ideType: "ANTIGRAVITY" } as const;

export const PROVIDER = "google-antigravity";
export const AUTH_FILE = join(homedir(), ".vnmaker", "auth.json");
/** W1–2 기본 프로젝트. 한 줄 받기 가 여기 story/nodes/hello.json 을 남긴다. */
export const PROJECT_DIR = process.env.VNMAKER_PROJECT_DIR ?? join(homedir(), ".vnmaker", "projects", "default");
export const GATEWAY_VERSION = "0.1.0";
/**
 * /api JSON 바디 상한. 로컬 프로세스가 GB 급 POST 로 게이트웨이를 OOM 시키지 못하게 한다.
 * vite 미들웨어(버퍼링)와 hono(bodyLimit)가 같은 값을 쓴다.
 */
export const API_BODY_MAX = 4 * 1024 * 1024;

/**
 * losia.online 에셋 스토어. 브라우저가 직접 부르면 CORS 에 막히므로 게이트웨이가 대신 부른다.
 * 요청마다 읽어야 테스트가 업스트림을 뒤집을 수 있다(이미지 백엔드와 같은 이유).
 */
export function losiaBaseUrl(): string {
  return (process.env.VNMAKER_LOSIA_URL ?? "https://losia.online").replace(/\/+$/, "");
}
export const LOSIA_TIMEOUT_MS = Number(process.env.VNMAKER_LOSIA_TIMEOUT_MS ?? 20_000);
/** 업로드는 다운로드보다 훨씬 오래 걸린다 — 작품 ZIP 이 수백 MB 일 수 있다. */
export const LOSIA_UPLOAD_TIMEOUT_MS = Number(process.env.VNMAKER_LOSIA_UPLOAD_TIMEOUT_MS ?? 600_000);
/** 카탈로그 한 번에 받는 최대 개수. 앱은 12~24 정도만 쓴다. */
export const LOSIA_TAKE_MAX = Number(process.env.VNMAKER_LOSIA_TAKE_MAX ?? 60);
/** 자산 한 파일 상한(계약: 이미지 10MB). 로컬 프록시가 무한정 메모리를 쓰지 않게 한다. */
export const LOSIA_FILE_MAX_BYTES = Number(process.env.VNMAKER_LOSIA_FILE_MAX ?? 64 * 1024 * 1024);
/** 게시 프록시가 받는 작품 ZIP 상한 — losia 계약과 같다(700MB). 스트리밍 전달이라 메모리를 먹지 않는다. */
export function losiaWorkMaxBytes(): number {
  return Number(process.env.VNMAKER_LOSIA_WORK_MAX ?? 700 * 1024 * 1024);
}
/** 에셋 게시 상한 — 계약은 이미지 32장×10MB·소리 20MB 다. 경계 값에 여유를 둔다. */
export function losiaAssetMaxBytes(): number {
  return Number(process.env.VNMAKER_LOSIA_ASSET_MAX ?? 360 * 1024 * 1024);
}
/** losia 개인 토큰(la_…)의 로컬 저장 위치. 0600 으로 쓴다. */
export const LOSIA_TOKEN_FILE = process.env.VNMAKER_LOSIA_TOKEN_FILE ?? join(homedir(), ".vnmaker", "losia-token.json");
/**
 * 업로드 스트리밍 경로 — 이 경로들은 4MB 버퍼 상한을 타지 않고 요청 본문을 그대로 흘린다.
 * vite 미들웨어(packages/app/vite.config.ts)와 데스크톱 서버(packages/desktop/src/server.ts)가 같은 목록을 쓴다.
 */
export const LOSIA_UPLOAD_PATHS: ReadonlySet<string> = new Set(["/api/losia/works", "/api/losia/assets"]);

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
