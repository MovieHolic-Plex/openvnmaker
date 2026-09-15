/**
 * Codex CLI 이미지 백엔드. agy IMAGE 모달리티 대신 로컬 `codex exec` 를 띄워
 * 내장 image-generation 스킬로 그린다. 산출물은
 * $CODEX_HOME/generated_images/<session-id>/exec-*.png 에 떨어지고,
 * 이 프로세스가 읽어 게이트웨이의 보통 이미지 저장소로 옮긴다.
 *
 * 인증은 codex 쪽이 책임진다(자기 auth.json·config.toml) — 이 경로는
 * 게이트웨이의 Google OAuth 를 요구하지 않는다.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CODEX_BIN, CODEX_HOME_DIR, CODEX_IMAGES_DIR, CODEX_IMAGE_TIMEOUT_MS, CODEX_WORK_DIR } from "../config.js";
import { UpstreamError } from "../http.js";
import type { ImageResult, InlineImage } from "../cca/images.js";

/** 생성 힌트 — 사용자가 실제로 굴린 프롬프트도 같은 식의 구도 지시를 썼다. */
const ASPECT_HINTS: Record<string, string> = {
  "16:9": "Wide landscape 16:9 composition.",
  "3:2": "Landscape 3:2 composition.",
  "4:3": "Landscape 4:3 composition.",
  "1:1": "Square 1:1 composition.",
  "9:16": "Portrait vertical 9:16 composition.",
  "3:4": "Portrait vertical 3:4 composition.",
  "2:3": "Portrait vertical 2:3 composition.",
};

/** 순수 함수 — 프롬프트 조립을 네트워크/프로세스 없이 검증한다. */
export function codexImagePrompt(prompt: string, aspectRatio?: string, imageSize?: string): string {
  const aspect = aspectRatio === undefined ? "" : `${ASPECT_HINTS[aspectRatio] ?? `Aspect ratio ${aspectRatio}.`} `;
  const size = imageSize === "2K" || imageSize === "4K" ? "High resolution. " : "";
  return `Create exactly one image with the image-generation skill, then stop. ${aspect}${size}\n${prompt}`;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export interface ImagesSnapshot {
  /** 세션 디렉터리 이름 → 그 안의 파일 이름 집합 */
  readonly dirs: ReadonlyMap<string, ReadonlySet<string>>;
}

/** generated_images 아래 세션별 파일 목록의 스냅샷. 없는 디렉터리는 빈 스냅샷. */
export async function snapshotImages(imagesDir: string): Promise<ImagesSnapshot> {
  const dirs = new Map<string, Set<string>>();
  let sessions: string[];
  try {
    sessions = await readdir(imagesDir);
  } catch {
    return { dirs };
  }
  for (const session of sessions) {
    try {
      dirs.set(session, new Set(await readdir(join(imagesDir, session))));
    } catch {
      // 파일이면 스킵 — 세션 디렉터리만 본다.
    }
  }
  return { dirs };
}

/** 스냅샷 이후 새로 나타난 이미지 파일의 절대 경로. 파일명 순으로 정렬한다. */
export async function collectNewImages(imagesDir: string, before: ImagesSnapshot): Promise<string[]> {
  const found: string[] = [];
  let sessions: string[];
  try {
    sessions = await readdir(imagesDir);
  } catch {
    return found;
  }
  for (const session of sessions) {
    const known = before.dirs.get(session);
    let files: string[];
    try {
      files = await readdir(join(imagesDir, session));
    } catch {
      continue;
    }
    for (const file of files) {
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      if (known?.has(file)) continue;
      found.push(join(imagesDir, session, file));
    }
  }
  return found.sort();
}

/** 세션 id 를 알면 그 디렉터리 하나만 읽는다 — 동시에 돌던 다른 세션 산출물과 안 섞인다. */
async function collectSessionImages(imagesDir: string, sessionId: string): Promise<string[]> {
  try {
    return (await readdir(join(imagesDir, sessionId)))
      .filter((file) => IMAGE_EXTENSIONS.has(file.split(".").pop()?.toLowerCase() ?? ""))
      .sort()
      .map((file) => join(imagesDir, sessionId, file));
  } catch {
    return [];
  }
}

/** --json JSONL 에서 세션 id·에이전트 문장·usage 를 걷어낸다. 순수 함수. */
export function parseCodexJsonl(stdout: string): { sessionId?: string; text: string[]; usage?: Record<string, unknown> } {
  const text: string[] = [];
  let sessionId: string | undefined;
  let usage: Record<string, unknown> | undefined;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = event["type"];
    if (type === "thread.started" && typeof event["thread_id"] === "string") sessionId = event["thread_id"];
    if (sessionId === undefined && typeof event["session_id"] === "string") sessionId = event["session_id"];
    if (type === "item.completed") {
      const item = event["item"] as Record<string, unknown> | undefined;
      if (item?.["type"] === "agent_message" && typeof item["text"] === "string") text.push(item["text"]);
    }
    if (type === "turn.completed" && event["usage"] !== null && typeof event["usage"] === "object") {
      usage = event["usage"] as Record<string, unknown>;
    }
  }
  return { ...(sessionId === undefined ? {} : { sessionId }), text, ...(usage === undefined ? {} : { usage }) };
}

export interface CodexSpawnDeps {
  readonly spawnFn?: (bin: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  readonly imagesDir?: string;
  readonly workDir?: string;
  readonly bin?: string;
  readonly timeoutMs?: number;
}

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

const STDOUT_CAP = 4 * 1024 * 1024;
const STDERR_CAP = 256 * 1024;

function runCodex(bin: string, args: readonly string[], options: SpawnOptions, prompt: string, timeoutMs: number, signal: AbortSignal | undefined, spawnFn: NonNullable<CodexSpawnDeps["spawnFn"]>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(bin, args, options);
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      kill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", reject);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < STDOUT_CAP) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString("utf8");
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted });
    });
    child.once("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
    child.stdin?.on("error", () => {
      // 자식이 stdin 을 일찍 닫아도 진행은 stdout/close 로 판단한다.
    });
    child.stdin?.end(prompt);
  });
}

/**
 * codex exec 는 무겁다 — 동시에 두 세션을 띄우면 스킬이 같은
 * generated_images 디렉터리 규칙으로 쓰므로 섞인다. 직렬화한다.
 */
let queue: Promise<void> = Promise.resolve();

export interface CodexImageParams {
  readonly prompt: string;
  readonly aspectRatio?: string;
  readonly imageSize?: string;
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export function codexGenerateImage(params: CodexImageParams, deps: CodexSpawnDeps = {}): Promise<ImageResult> {
  const run = queue.then(() => doGenerate(params, deps));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doGenerate(params: CodexImageParams, deps: CodexSpawnDeps): Promise<ImageResult> {
  const bin = deps.bin ?? CODEX_BIN;
  const workDir = deps.workDir ?? CODEX_WORK_DIR;
  const imagesDir = deps.imagesDir ?? CODEX_IMAGES_DIR;
  const timeoutMs = deps.timeoutMs ?? CODEX_IMAGE_TIMEOUT_MS;
  const spawnFn = deps.spawnFn ?? ((b, a, o) => spawn(b, a as string[], o));

  await mkdir(workDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });
  const before = await snapshotImages(imagesDir);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "-s",
    "workspace-write",
    "-c",
    'approval_policy="never"',
    "--json",
    ...(params.model === undefined ? [] : ["-m", params.model]),
    "-",
  ];

  const result = await runCodex(bin, args, { cwd: workDir, stdio: ["pipe", "pipe", "pipe"], env: process.env }, codexImagePrompt(params.prompt, params.aspectRatio, params.imageSize), timeoutMs, params.signal, spawnFn);

  const parsed = parseCodexJsonl(result.stdout);
  const found = parsed.sessionId === undefined
    ? await collectNewImages(imagesDir, before)
    : await collectSessionImages(imagesDir, parsed.sessionId);

  const images: InlineImage[] = [];
  for (const file of found) {
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    const bytes = await readFile(file);
    images.push({ mimeType: MIME_BY_EXTENSION[ext] ?? "application/octet-stream", data: bytes.toString("base64") });
  }

  if (images.length === 0) {
    if (params.signal?.aborted || result.aborted) throw new UpstreamError("이미지 생성이 취소됐다", 499, "");
    if (result.timedOut) throw new UpstreamError(`codex 이미지 생성이 ${Math.round(timeoutMs / 1000)}초를 넘겼다`, 504, result.stderr.slice(-1200));
    const detail = (parsed.text.at(-1) ?? result.stderr).slice(-1200).trim();
    throw new UpstreamError(`codex 가 이미지를 만들지 않았다${detail ? `: ${detail}` : ""}`, 502, detail);
  }

  return {
    images,
    text: parsed.text,
    ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
    host: "codex-cli",
    model: params.model ?? (await codexModelName()),
  };
}

/** ~/.codex/config.toml 의 model 값. 없으면 "codex" — 라벨링용이라 실패해도 된다. */
export async function codexModelName(homeDir: string = CODEX_HOME_DIR): Promise<string> {
  try {
    const config = await readFile(join(homeDir, "config.toml"), "utf8");
    const match = config.match(/^model\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? "codex";
  } catch {
    return "codex";
  }
}

/** 바이너리 존재 확인. /api/image/config 가 UI 상태 표시에 쓴다. */
export async function codexAvailable(bin: string = CODEX_BIN): Promise<boolean> {
  return new Promise((accept) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, ["--version"], { stdio: "ignore" });
    } catch {
      accept(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      accept(false);
    }, 10_000);
    child.once("error", () => {
      clearTimeout(timer);
      accept(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      accept(code === 0);
    });
  });
}
