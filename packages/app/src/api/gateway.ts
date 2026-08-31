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
