import { ccaHeaders } from "../config.js";
import { createTurnAccumulator, isContextErrorPayload } from "./production-parts.js";
import { validateProductionEnvelope } from "./production-request.js";
import { createIncrementalSseParser } from "./production-sse.js";
import type { CompleteFunctionCall, ProductionEnvelope, ProductionTurnResult } from "./production-types.js";
import { readObject } from "./production-util.js";

export type RunProductionTurnInput = {
  readonly envelope: ProductionEnvelope | Readonly<Record<string, unknown>>;
  readonly host: string;
  readonly accessToken: string;
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
  readonly onFunctionCall?: (call: CompleteFunctionCall) => void;
  readonly onProgress?: () => void;
};

function isAbort(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function readErrorBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < 1200) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();
  return text.slice(0, 1200);
}

export async function runProductionTurn(input: RunProductionTurnInput): Promise<ProductionTurnResult> {
  const validated = validateProductionEnvelope(input.envelope);
  if (validated.kind !== "ok") return { kind: "capability", reason: validated.reason };
  const fetchImpl = input.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${input.host}/v1internal:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { ...ccaHeaders(input.accessToken), Accept: "text/event-stream" },
      body: validated.wireBody,
      signal: input.signal,
    });
  } catch (error: unknown) {
    return isAbort(input.signal, error) ? { kind: "cancelled" } : { kind: "unknown", dispatchCount: 0 };
  }
  if (res.status === 401) return { kind: "auth" };
  if (res.status === 403) return { kind: "capability", reason: "FORBIDDEN" };
  if (res.status === 429) return { kind: "quota" };
  if (!res.ok) {
    const body = await readErrorBody(res);
    let error: ReturnType<typeof readObject>;
    try {
      error = readObject(readObject(JSON.parse(body) as unknown)?.["error"]);
    } catch {
      error = undefined;
    }
    if (isContextErrorPayload(res.status, body, error)) return { kind: "provider-context-exceeded" };
    return { kind: "unknown", dispatchCount: 0 };
  }
  if (res.body === null) return { kind: "unknown", dispatchCount: 0 };
  const parser = createIncrementalSseParser();
  const acc = createTurnAccumulator();
  const reader = res.body.getReader();
  const consume = (events: readonly unknown[]): void => {
    if (events.length > 0) input.onProgress?.();
    for (const event of events) acc.add(event);
  };
  try {
    while (true) {
      if (input.signal.aborted) {
        await reader.cancel();
        return { kind: "cancelled" };
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      consume(parser.push(chunk.value).events);
    }
  } catch (error: unknown) {
    return isAbort(input.signal, error) ? { kind: "cancelled" } : { kind: "unknown", dispatchCount: 0 };
  }
  const finished = parser.finish();
  consume(finished.events);
  return acc.finalize(finished.remainder, input.onFunctionCall);
}
