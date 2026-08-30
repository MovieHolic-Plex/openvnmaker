import { REQUEST_TIMEOUT_MS } from "./config.js";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** JSON 왕복 하나. 200 이 아니면 UpstreamError 로 올린다. */
export async function jsonFetch<T>(
  label: string,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError") throw new UpstreamError(`${label}: ${timeoutMs}ms 안에 응답 없음`, 504, url);
    throw new UpstreamError(`${label}: ${err instanceof Error ? err.message : String(err)}`, 502, url);
  }
  const text = await res.text();
  if (res.status !== 200) {
    throw new UpstreamError(`${label} 실패: ${res.status} ${res.statusText}`, res.status, text.slice(0, 1200));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`${label}: JSON 파싱 실패`, 502, text.slice(0, 400));
  }
}
