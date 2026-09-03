export interface AuthStatus {
  readonly reachable: boolean;
  readonly authenticated: boolean;
  readonly email: string | null;
  readonly projectId: string | null;
  readonly error: string | null;
}

export interface GenerateResponse {
  readonly text: string;
  readonly model: string;
  readonly host: string;
  readonly unofficial: boolean;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 240) || `HTTP ${res.status}` };
  }
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch("/api/auth/status", { signal: AbortSignal.timeout(8_000) });
    const body = await readJson(res);
    if (!res.ok) {
      return { reachable: true, authenticated: false, email: null, projectId: null, error: String(body["error"] ?? res.status) };
    }
    const authenticated = body["authenticated"] === true;
    return {
      reachable: true,
      authenticated,
      email: typeof body["email"] === "string" ? body["email"] : null,
      projectId: typeof body["projectId"] === "string" ? body["projectId"] : null,
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      authenticated: false,
      email: null,
      projectId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function startLogin(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/login", { method: "POST", signal: AbortSignal.timeout(300_000) });
  const body = await readJson(res);
  if (!res.ok) throw new Error(String(body["error"] ?? `login ${res.status}`));
  return fetchAuthStatus();
}

export async function generateLine(): Promise<GenerateResponse> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(120_000),
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

export async function saveNode(node: unknown): Promise<string> {
  const res = await fetch("/api/project/nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

export interface AgentResponse {
  readonly text: string;
  readonly diffs: readonly AgentDiff[];
  readonly playFrom: string | null;
  readonly node: unknown;
}

export async function runAgent(message: string, nodeId?: string): Promise<AgentResponse> {
  const res = await fetch("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(nodeId === undefined ? {} : { nodeId }) }),
    signal: AbortSignal.timeout(180_000),
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
  return {
    text: typeof body["text"] === "string" ? body["text"] : "",
    diffs,
    playFrom: typeof body["playFrom"] === "string" ? body["playFrom"] : null,
    node: body["node"] ?? null,
  };
}
