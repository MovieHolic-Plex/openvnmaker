/**
 * agy 텍스트 생성. 이미지와 같은 v1internal:streamGenerateContent 를 쓰고
 * responseModalities 는 넣지 않는다(기본 TEXT). project 는 필수다.
 */
import { CCA_HOSTS, GENERATE_MAX_OUTPUT_TOKENS, GENERATE_TIMEOUT_MS, TEXT_MODEL, ccaHeaders } from "../config.js";
import { UpstreamError } from "../http.js";
import { parseSseChunks } from "./images.js";

export interface GenerateParams {
  readonly prompt: string;
  readonly projectId: string;
  readonly model?: string;
}

export interface GenerateResult {
  readonly text: string;
  readonly usage?: Record<string, unknown>;
  readonly host: string;
  readonly model: string;
}

interface ResponseChunk {
  readonly response?: {
    readonly candidates?: readonly {
      readonly content?: {
        readonly parts?: readonly { readonly text?: string; readonly thought?: boolean }[];
      };
      readonly finishReason?: string;
    }[];
    readonly usageMetadata?: Record<string, unknown>;
    readonly promptFeedback?: { readonly blockReason?: string };
  };
}

/** 순수 함수. 네트워크 없이 봉투를 검증할 수 있다. */
export function buildGenerateRequest(params: GenerateParams): Record<string, unknown> {
  const model = params.model ?? TEXT_MODEL;
  return {
    project: params.projectId,
    model,
    request: {
      contents: [{ role: "user", parts: [{ text: params.prompt }] }],
      generationConfig: {
        maxOutputTokens: GENERATE_MAX_OUTPUT_TOKENS,
        temperature: 0.9,
        candidateCount: 1,
      },
    },
    requestType: "agent",
    requestId: `vnmaker-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    userAgent: "antigravity",
  };
}

/** 청크에서 텍스트만 걷어낸다. 순수 함수. */
export function collectText(chunks: readonly ResponseChunk[]): {
  text: string;
  usage?: Record<string, unknown>;
  blockReason?: string;
} {
  const parts: string[] = [];
  let usage: Record<string, unknown> | undefined;
  let blockReason: string | undefined;

  for (const chunk of chunks) {
    const response = chunk.response;
    if (!response) continue;
    if (response.promptFeedback?.blockReason) blockReason = response.promptFeedback.blockReason;
    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text && part.thought !== true) parts.push(part.text);
      }
    }
    if (response.usageMetadata) usage = response.usageMetadata;
  }

  return { text: parts.join("").trim(), ...(usage === undefined ? {} : { usage }), ...(blockReason === undefined ? {} : { blockReason }) };
}

async function postGenerate(host: string, accessToken: string, body: unknown, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${host}/v1internal:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { ...ccaHeaders(accessToken), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 1200);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // 원문 유지
    }
    throw new UpstreamError(`텍스트 생성 실패: ${res.status} ${res.statusText} — ${message}`, res.status, text.slice(0, 1200));
  }
  return text;
}

export async function generateText(accessToken: string, params: GenerateParams): Promise<GenerateResult> {
  const model = params.model ?? TEXT_MODEL;
  const body = buildGenerateRequest({ ...params, model });
  let lastError: unknown;

  for (const [index, host] of CCA_HOSTS.entries()) {
    const isLast = index === CCA_HOSTS.length - 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
    try {
      const raw = await postGenerate(host, accessToken, body, controller.signal);
      const parsed = collectText(parseSseChunks(raw) as ResponseChunk[]);
      // #region agent log
      fetch("http://127.0.0.1:7330/ingest/088c962c-eab4-4360-b110-81b67b33fb9f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4259b0" },
        body: JSON.stringify({
          sessionId: "4259b0",
          runId: "w1",
          hypothesisId: "A",
          location: "packages/gateway/src/cca/generate.ts:generateText",
          message: "cca generate parsed",
          data: {
            host,
            model,
            textLength: parsed.text.length,
            blockReason: parsed.blockReason ?? null,
            rawChars: raw.length,
            thoughtsTokenCount: (parsed.usage?.["thoughtsTokenCount"] as number | undefined) ?? 0,
            candidatesTokenCount: (parsed.usage?.["candidatesTokenCount"] as number | undefined) ?? 0,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (parsed.text === "" || parsed.text.length < 8) {
        const detail = parsed.blockReason
          ? `blockReason ${parsed.blockReason}`
          : parsed.text === ""
            ? "빈 응답"
            : `너무 짧다 (${parsed.text.length}자)`;
        throw new UpstreamError(`텍스트가 안 왔다: ${detail}`, 502, detail);
      }
      return { text: parsed.text, ...(parsed.usage === undefined ? {} : { usage: parsed.usage }), host, model };
    } catch (err) {
      lastError = err;
      const retryable =
        !isLast &&
        ((err instanceof UpstreamError && (err.status === 429 || err.status >= 500)) ||
          (err instanceof Error && err.name === "AbortError"));
      if (!retryable) throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("텍스트 생성 실패");
}
