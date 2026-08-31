import {
  CCA_HOSTS,
  FREE_TIER_ID,
  LOAD_CODE_ASSIST_METADATA,
  ONBOARD_POLL_INTERVAL_MS,
  ONBOARD_TIMEOUT_MS,
  ccaHeaders,
} from "../config.js";
import { UpstreamError, jsonFetch } from "../http.js";

export interface ModelQuota {
  readonly remainingFraction: number;
  readonly resetTime?: string;
}

export interface ModelEntry {
  readonly id: string;
  readonly displayName?: string;
  readonly provider?: string;
  readonly supportsThinking?: boolean;
  readonly supportsImages?: boolean;
  readonly recommended?: boolean;
  /** 업스트림과 같은 이름을 쓴다. 필드명을 바꾸면 소비자가 두 이름을 다 알아야 한다. */
  readonly quotaInfo?: ModelQuota;
}

export interface RawModel {
  readonly displayName?: string;
  readonly modelProvider?: string;
  readonly apiProvider?: string;
  readonly supportsThinking?: boolean;
  readonly supportsImages?: boolean;
  readonly recommended?: boolean;
  readonly quotaInfo?: { readonly remainingFraction?: number; readonly resetTime?: string };
}

interface LoadCodeAssistResponse {
  readonly cloudaicompanionProject?: string;
  readonly currentTier?: { readonly id?: string } | null;
  readonly paidTier?: unknown;
  readonly allowedTiers?: readonly { readonly id?: string }[];
  readonly ineligibleTiers?: readonly { readonly tierId?: string; readonly reasonMessage?: string; readonly validationUrl?: string }[];
}

interface Operation {
  readonly done?: boolean;
  readonly name?: string;
  readonly error?: { readonly code?: number; readonly message?: string };
  readonly response?: unknown;
}

/**
 * 1차 호스트가 네트워크 오류나 5xx 를 내면 sandbox 호스트로 한 번 물러난다.
 * 어느 호스트가 답했는지 함께 돌려준다 — 내부 표면이라 관측이 유일한 방어다.
 */
async function ccaCall<T>(
  method: string,
  accessToken: string,
  body: unknown,
  timeoutMs?: number,
): Promise<{ data: T; host: string }> {
  let lastError: unknown;
  for (const host of CCA_HOSTS) {
    try {
      const data = await jsonFetch<T>(
        method,
        `${host}/v1internal:${method}`,
        { method: "POST", headers: ccaHeaders(accessToken), body: JSON.stringify(body) },
        timeoutMs,
      );
      return { data, host };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof UpstreamError && (err.status >= 500 || err.status === 502 || err.status === 504);
      if (!retryable) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${method} 실패`);
}

async function operationGet(host: string, name: string, accessToken: string, timeoutMs: number): Promise<Operation> {
  return jsonFetch<Operation>(
    "onboardUser operation",
    `${host}/v1internal/${name}`,
    { method: "GET", headers: ccaHeaders(accessToken) },
    timeoutMs,
  );
}

export async function loadCodeAssist(accessToken: string): Promise<{ payload: LoadCodeAssistResponse; host: string }> {
  const first = await ccaCall<LoadCodeAssistResponse>("loadCodeAssist", accessToken, {
    metadata: LOAD_CODE_ASSIST_METADATA,
  });
  const projectId = first.data.cloudaicompanionProject;
  if (first.data.paidTier == null && projectId) {
    const second = await ccaCall<LoadCodeAssistResponse>("loadCodeAssist", accessToken, {
      cloudaicompanionProject: projectId,
      metadata: LOAD_CODE_ASSIST_METADATA,
    });
    return { payload: second.data, host: second.host };
  }
  return { payload: first.data, host: first.host };
}

function assertFreeTierEligible(payload: LoadCodeAssistResponse): void {
  if (payload.allowedTiers?.some((t) => t.id === FREE_TIER_ID)) return;
  const tier = payload.ineligibleTiers?.find((t) => t.tierId === FREE_TIER_ID);
  if (!tier?.reasonMessage) return;
  throw new Error(`${tier.reasonMessage}${tier.validationUrl ? `\n${tier.validationUrl}` : ""}`);
}

export async function onboardUser(accessToken: string): Promise<void> {
  const deadline = Date.now() + ONBOARD_TIMEOUT_MS;
  const remaining = (): number => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`onboardUser 가 ${ONBOARD_TIMEOUT_MS}ms 안에 안 끝났다`);
    return left;
  };
  const started = await ccaCall<Operation>(
    "onboardUser",
    accessToken,
    { tierId: FREE_TIER_ID, metadata: LOAD_CODE_ASSIST_METADATA },
    remaining(),
  );
  let op = started.data;
  while (op.done !== true) {
    await new Promise((r) => setTimeout(r, Math.min(ONBOARD_POLL_INTERVAL_MS, remaining())));
    if (!op.name) throw new Error("onboardUser 가 operation name 없이 응답했다");
    op = await operationGet(started.host, op.name, accessToken, remaining());
  }
  if (op.error) throw new Error(`onboardUser 실패: ${op.error.code ?? ""} ${op.error.message ?? ""}`.trim());
  if (!op.response) throw new Error("OnboardUserResponse 가 비어 있다");
}

export async function discoverProject(accessToken: string): Promise<string> {
  const initial = await loadCodeAssist(accessToken);
  assertFreeTierEligible(initial.payload);
  if (initial.payload.currentTier == null) await onboardUser(accessToken);
  const refreshed = await loadCodeAssist(accessToken);
  const projectId = refreshed.payload.cloudaicompanionProject;
  if (!projectId) throw new Error("loadCodeAssist 가 cloudaicompanionProject 를 주지 않았다");
  return projectId;
}

/**
 * 업스트림 맵을 정렬된 배열로 편다. 순수 함수라 네트워크 없이 검사할 수 있다.
 */
export function mapModels(raw: Record<string, RawModel> | undefined): ModelEntry[] {
  const source = raw ?? {};
  return Object.keys(source)
    .sort()
    .map((id) => {
      const m = source[id];
      const fraction = m?.quotaInfo?.remainingFraction;
      return {
        id,
        ...(m?.displayName === undefined ? {} : { displayName: m.displayName }),
        ...(m?.modelProvider ?? m?.apiProvider ? { provider: m?.modelProvider ?? m?.apiProvider } : {}),
        ...(m?.supportsThinking === undefined ? {} : { supportsThinking: m.supportsThinking }),
        ...(m?.supportsImages === undefined ? {} : { supportsImages: m.supportsImages }),
        ...(m?.recommended === undefined ? {} : { recommended: m.recommended }),
        ...(typeof fraction === "number"
          ? {
              quotaInfo: {
                remainingFraction: fraction,
                ...(m?.quotaInfo?.resetTime === undefined ? {} : { resetTime: m.quotaInfo.resetTime }),
              },
            }
          : {}),
      };
    });
}

export async function fetchAvailableModels(accessToken: string): Promise<{ models: ModelEntry[]; host: string }> {
  const { data, host } = await ccaCall<{ models?: Record<string, RawModel> }>(
    "fetchAvailableModels",
    accessToken,
    {},
  );
  return { models: mapModels(data.models), host };
}
