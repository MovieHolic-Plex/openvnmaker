/**
 * 에이전트 턴용 CCA. 텍스트 생성과 같은 호스트를 쓰고 tools 만 얹는다.
 */
import { AGENT_MAX_OUTPUT_TOKENS, CCA_HOSTS, GENERATE_TIMEOUT_MS, TEXT_MODEL, ccaHeaders } from "../config.js";
import { UpstreamError } from "../http.js";
import { parseSseChunks } from "./images.js";
import type { AgentModelInput, AgentModelOutput } from "../agent/run.js";
import { AGENT_DECLARATIONS, type ToolCall } from "../agent/tools.js";

interface ResponseChunk {
  readonly response?: {
    readonly candidates?: readonly {
      readonly content?: {
        readonly parts?: readonly {
          readonly text?: string;
          readonly thought?: boolean;
          readonly functionCall?: { readonly name?: string; readonly args?: Record<string, unknown> };
        }[];
      };
    }[];
    readonly promptFeedback?: { readonly blockReason?: string };
  };
}

export function collectAgentOutput(chunks: readonly ResponseChunk[]): { text: string; calls: ToolCall[] } {
  const parts: string[] = [];
  const calls: ToolCall[] = [];
  for (const chunk of chunks) {
    for (const candidate of chunk.response?.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.functionCall?.name) {
          calls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
        } else if (part.text && part.thought !== true) {
          parts.push(part.text);
        }
      }
    }
  }
  return { text: parts.join("").trim(), calls };
}

/** 네이티브 functionCall 이 없을 때 모델이 JSON 으로 도구를 적은 경우. */
export function parseToolJson(text: string): ToolCall[] {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const name = typeof parsed["tool"] === "string" ? parsed["tool"] : typeof parsed["name"] === "string" ? parsed["name"] : "";
    if (name === "" || name === "done") return [];
    const args = parsed["args"];
    return [{ name, args: args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {} }];
  } catch {
    return [];
  }
}

export function buildAgentRequest(params: {
  readonly prompt: string;
  readonly projectId: string;
  readonly history: AgentModelInput["history"];
  readonly model?: string;
}): Record<string, unknown> {
  const model = params.model ?? TEXT_MODEL;
  const contents: Record<string, unknown>[] = [{ role: "user", parts: [{ text: params.prompt }] }];
  for (const step of params.history) {
    contents.push({
      role: "model",
      parts: [{ functionCall: { name: step.call.name, args: step.call.args } }],
    });
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: step.call.name,
            response: { output: JSON.stringify(step.result.ok ? step.result.data ?? { diff: step.result.diff } : { error: step.result.error }) },
          },
        },
      ],
    });
  }
  return {
    project: params.projectId,
    model,
    request: {
      contents,
      systemInstruction: {
        parts: [
          {
            text: "닫힌 도구만 사용한다. 자유 파일 쓰기 금지. 본문에 소설을 쓰지 마라. 끝나면 play_from.",
          },
        ],
      },
      generationConfig: {
        maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
        temperature: 0.4,
        candidateCount: 1,
      },
      tools: [{ functionDeclarations: AGENT_DECLARATIONS }],
      toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
    },
    requestType: "agent",
    requestId: `vnmaker-agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    userAgent: "antigravity",
  };
}

async function postAgent(host: string, accessToken: string, body: unknown, signal: AbortSignal): Promise<string> {
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
      // 원문
    }
    throw new UpstreamError(`에이전트 실패: ${res.status} ${res.statusText} — ${message}`, res.status, text.slice(0, 1200));
  }
  return text;
}

export async function runCcaAgentModel(
  accessToken: string,
  projectId: string,
  input: AgentModelInput,
): Promise<AgentModelOutput> {
  const body = buildAgentRequest({ prompt: input.prompt, projectId, history: input.history });
  let lastError: unknown;
  for (const [index, host] of CCA_HOSTS.entries()) {
    const isLast = index === CCA_HOSTS.length - 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
    try {
      const raw = await postAgent(host, accessToken, body, controller.signal);
      const parsed = collectAgentOutput(parseSseChunks(raw) as ResponseChunk[]);
      const calls = parsed.calls.length > 0 ? parsed.calls : parseToolJson(parsed.text);
      return { ...(parsed.text === "" ? {} : { text: parsed.text }), calls };
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
  throw lastError instanceof Error ? lastError : new Error("에이전트 실패");
}
