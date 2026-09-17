/** 게이트웨이가 mutation 에 요구하는 편집기 표시 — 없으면 403. */
const STUDIO_HEADER = { "X-VNMaker-Studio": "1" } as const;

export interface AuthStatus {
  readonly reachable: boolean;
  readonly authenticated: boolean;
  readonly email: string | null;
  readonly projectId: string | null;
  readonly error: string | null;
  /** 인증 제공자 — "losia" 면 Google OAuth 대신 사이트 로그인으로 보낸다. */
  readonly provider: string | null;
  /** 로그인해야 할 때 서버가 주는 사이트 경로 — 있으면 그 주소로 이동한다. */
  readonly loginUrl: string | null;
}

export interface GenerateResponse {
  readonly text: string;
  readonly model: string;
  readonly host: string;
  readonly unofficial: boolean;
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 240) || `HTTP ${res.status}` };
  }
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch("/api/auth/status", { headers: STUDIO_HEADER, signal: AbortSignal.timeout(8_000) });
    const body = await readJson(res);
    const provider = typeof body["provider"] === "string" ? body["provider"] : null;
    const loginUrl = typeof body["loginUrl"] === "string" ? body["loginUrl"] : null;
    if (!res.ok) {
      return { reachable: true, authenticated: false, email: null, projectId: null, error: String(body["error"] ?? res.status), provider, loginUrl };
    }
    const authenticated = body["authenticated"] === true;
    return {
      reachable: true,
      authenticated,
      email: typeof body["email"] === "string" ? body["email"] : null,
      projectId: typeof body["projectId"] === "string" ? body["projectId"] : null,
      error: null,
      provider,
      loginUrl,
    };
  } catch (err) {
    return {
      reachable: false,
      authenticated: false,
      email: null,
      projectId: null,
      error: err instanceof Error ? err.message : String(err),
      provider: null,
      loginUrl: null,
    };
  }
}

export async function startLogin(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/login", { method: "POST", headers: STUDIO_HEADER, signal: AbortSignal.timeout(300_000) });
  const body = await readJson(res);
  // losia 처럼 사이트 로그인으로 대체하는 호스트는 loginUrl 을 돌려준다 — 그 주소로 보낸다.
  if (!res.ok) {
    const loginUrl = typeof body["loginUrl"] === "string" ? body["loginUrl"] : null;
    if (loginUrl && typeof window !== "undefined") {
      window.location.href = loginUrl;
      return new Promise<AuthStatus>(() => {});
    }
    throw new Error(String(body["error"] ?? `login ${res.status}`));
  }
  return fetchAuthStatus();
}

export async function generateLine(prompt?: string, signal?: AbortSignal): Promise<GenerateResponse> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { ...STUDIO_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(prompt === undefined ? {} : { prompt }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(600_000),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(String(body["error"] ?? `generate ${res.status}`));
  const text = typeof body["text"] === "string" ? body["text"].trim() : "";
  if (text === "") throw new Error("모델이 빈 문자열을 돌려줬다");
  return {
    text,
    model: typeof body["model"] === "string" ? body["model"] : "",
    host: typeof body["host"] === "string" ? body["host"] : "",
    unofficial: body["unofficial"] === true,
  };
}

/** 게이트웨이 프로젝트 그래프를 컴파일한 원고. issues 는 auditScript 결과다. */
export interface CompiledProject {
  readonly script: unknown;
  readonly issues: readonly { readonly severity?: string; readonly message?: string; readonly sceneId?: string }[];
}

export async function fetchProjectScript(signal?: AbortSignal): Promise<CompiledProject> {
  const res = await fetch("/api/project/script", { headers: STUDIO_HEADER, signal: signal ?? AbortSignal.timeout(15_000) });
  const body = await readJson(res);
  if (!res.ok) throw new Error(String(body["error"] ?? `project script ${res.status}`));
  if (body["script"] === null || typeof body["script"] !== "object") throw new Error("컴파일된 원고가 없다");
  return { script: body["script"], issues: Array.isArray(body["issues"]) ? (body["issues"] as CompiledProject["issues"]) : [] };
}

export async function saveNode(node: unknown): Promise<string> {
  const res = await fetch("/api/project/nodes", {
    method: "POST",
    headers: { ...STUDIO_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(node),
    signal: AbortSignal.timeout(8_000),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(String(body["error"] ?? `save ${res.status}`));
  return typeof body["path"] === "string" ? body["path"] : "";
}

export interface AgentDiff {
  readonly tool: string;
  readonly summary: string;
}

export interface AgentFailure {
  readonly tool: string;
  readonly error: string;
}

export interface AgentResponse {
  readonly text: string;
  readonly diffs: readonly AgentDiff[];
  readonly failures: readonly AgentFailure[];
  readonly playFrom: string | null;
  readonly node: unknown;
}

export async function runAgent(message: string, nodeId?: string): Promise<AgentResponse> {
  const res = await fetch("/api/agent/run", {
    method: "POST",
    headers: { ...STUDIO_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(nodeId === undefined ? {} : { nodeId }) }),
    signal: AbortSignal.timeout(600_000),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(String(body["error"] ?? `agent ${res.status}`));
  const diffs = Array.isArray(body["diffs"])
    ? body["diffs"].flatMap((item) => {
        if (item === null || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const tool = typeof row["tool"] === "string" ? row["tool"] : "";
        const summary = typeof row["summary"] === "string" ? row["summary"] : "";
        return tool === "" ? [] : [{ tool, summary }];
      })
    : [];
  const failures = Array.isArray(body["failures"])
    ? body["failures"].flatMap((item) => {
        if (item === null || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const tool = typeof row["tool"] === "string" ? row["tool"] : "";
        const error = typeof row["error"] === "string" ? row["error"] : "";
        return tool === "" ? [] : [{ tool, error }];
      })
    : [];
  return {
    text: typeof body["text"] === "string" ? body["text"] : "",
    diffs,
    failures,
    playFrom: typeof body["playFrom"] === "string" ? body["playFrom"] : null,
    node: body["node"] ?? null,
  };
}

export interface GenerateImageResult {
  readonly url: string;
  readonly name: string;
}

export type ImageBackend = "codex" | "agy";
export interface ImageBackendInfo { readonly id: ImageBackend; readonly model: string; readonly available: boolean; readonly authRequired: boolean; readonly unofficial: boolean; }

export async function generateImage(prompt: string, aspectRatio = "16:9", signal?: AbortSignal, backend?: ImageBackend): Promise<GenerateImageResult> {
  const res = await fetch("/api/image/generate", {
    method: "POST",
    headers: { ...STUDIO_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, aspectRatio, ...(backend ? { backend } : {}) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(600_000),
  });
  const body = await readJson(res);
  if (res.status === 401) throw new Error("로그인이 필요하다");
  if (!res.ok) throw new Error(String(body["error"] ?? `image ${res.status}`));
  const images = Array.isArray(body["images"]) ? body["images"] : [];
  const first = images[0];
  if (first === null || typeof first !== "object") throw new Error("이미지가 없다");
  const row = first as Record<string, unknown>;
  const url = typeof row["url"] === "string" ? row["url"] : "";
  if (url === "") throw new Error("이미지가 없다");
  return { url, name: typeof row["name"] === "string" ? row["name"] : "" };
}

export type ReviewSeverity = "high" | "medium" | "low";
export interface ReviewFinding {
  readonly severity: ReviewSeverity;
  readonly category: string;
  readonly summary: string;
  readonly sceneId?: string;
  readonly suggestion?: string;
}
export interface ReviewResult {
  readonly findings: readonly ReviewFinding[];
  readonly model: string;
  readonly unofficial: boolean;
}

/** agy(Gemini) 텍스트 모델로 원고 서사를 점검한다. 구조 검사(auditScript)와 별개다. */
export async function reviewStory(manuscript: unknown, focus?: string, signal?: AbortSignal): Promise<ReviewResult> {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { ...STUDIO_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify({ manuscript, ...(focus ? { focus } : {}) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
  });
  const body = await readJson(res);
  if (res.status === 401) throw new Error("로그인이 필요합니다. AI 어시스턴트에서 로그인하세요.");
  if (!res.ok) throw new Error(String(body["error"] ?? `review ${res.status}`));
  const findings = Array.isArray(body["findings"]) ? body["findings"] as ReviewFinding[] : [];
  return { findings, model: typeof body["model"] === "string" ? body["model"] : "", unofficial: body["unofficial"] === true };
}
