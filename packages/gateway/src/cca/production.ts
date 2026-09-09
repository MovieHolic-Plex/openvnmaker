import {
  admitBudget,
  bytesSchema,
  canonicalHash,
  generationUsageSchema,
  hashSchema,
  providerDispatchResultSchema,
  uuidSchema,
} from "../../../harness/src/index.js";
import type {
  BudgetAdmission,
  BudgetRequest,
  ProviderDispatch,
  ProviderDispatchRequest,
  ProviderDispatchResult,
} from "../../../harness/src/index.js";
import type { CredentialStore } from "../auth/credentials.js";
import type { GenerateResult } from "./generate.js";
import type { ImageResult, InlineImage } from "./images.js";
import { createSingleFlightAccess } from "./production-auth.js";
import { inspectProductionIncludes } from "./production-request.js";
import { runProductionTurn } from "./production-stream.js";
import type { ProductionClock, ProductionEnvelope, ProductionTurnResult, TokenRefreshResponse } from "./production-types.js";
import { assertNever, readObject } from "./production-util.js";

export { inspectJsonFragment } from "./production-json.js";
export { createIncrementalSseParser } from "./production-sse.js";
export { createSingleFlightAccess } from "./production-auth.js";
export { appendReplayTurn, buildProductionRequest, inspectProductionIncludes, validateProductionEnvelope } from "./production-request.js";
export { runProductionTurn } from "./production-stream.js";
export type { RunProductionTurnInput } from "./production-stream.js";
export type {
  CompleteFunctionCall,
  ProductionClock,
  ProductionCounterIncludes,
  ProductionEnvelope,
  ProductionRequestBuild,
  ProductionRequestInput,
  ProductionTurnResult,
  TokenRefreshResponse,
} from "./production-types.js";

export function mapProductionTurnToDispatch(
  result: ProductionTurnResult,
  artifact: { readonly artifactId: string; readonly hash: string; readonly bytes: number },
): ProviderDispatchResult {
  const receipt = {
    artifactId: uuidSchema.parse(artifact.artifactId),
    hash: hashSchema.parse(artifact.hash),
    bytes: bytesSchema.parse(artifact.bytes),
  };
  switch (result.kind) {
    case "succeeded":
      return providerDispatchResultSchema.parse({
        kind: "succeeded",
        artifact: receipt,
        usage: generationUsageSchema.parse({
          knownInputUsage: result.usage.knownInputUsage,
          knownOutputUsage: result.usage.knownOutputUsage,
        }),
      });
    case "missing-usage":
      return providerDispatchResultSchema.parse({
        kind: "succeeded",
        artifact: receipt,
        usage: generationUsageSchema.parse({ knownInputUsage: null, knownOutputUsage: null }),
      });
    case "incomplete":
    case "unknown":
    case "cancelled":
      return providerDispatchResultSchema.parse({ kind: "unknown", reason: result.kind });
    case "provider-context-exceeded":
      return providerDispatchResultSchema.parse({ kind: "context-limit" });
    case "auth":
      return providerDispatchResultSchema.parse({ kind: "auth" });
    case "quota":
      return providerDispatchResultSchema.parse({ kind: "quota" });
    case "capability":
      return providerDispatchResultSchema.parse({ kind: "capability" });
    default:
      return assertNever(result);
  }
}

export type ProductionTurnHook = (input: {
  readonly request: ProviderDispatchRequest;
  readonly result: ProductionTurnResult;
  readonly envelope: ProductionEnvelope;
}) => void | Promise<void>;

export type ProductionDispatchDeps = {
  readonly host: string;
  readonly store: CredentialStore;
  readonly clock: ProductionClock;
  readonly refresh: (refreshToken: string) => Promise<TokenRefreshResponse>;
  readonly loadTurn: (request: ProviderDispatchRequest) => Promise<{
    readonly envelope: ProductionEnvelope;
    readonly artifactId: string;
    readonly hash: string;
    readonly bytes: number;
  }>;
  readonly fetch?: typeof fetch;
  readonly onTurn?: ProductionTurnHook;
};

export function createProductionDispatch(deps: ProductionDispatchDeps): ProviderDispatch {
  const access = createSingleFlightAccess(deps);
  return {
    async dispatch(request) {
      const fresh = await access.ensureFreshAccess();
      if (fresh === null) return { kind: "auth" };
      const loaded = await deps.loadTurn(request);
      const result = await runProductionTurn({
        envelope: loaded.envelope,
        host: deps.host,
        accessToken: fresh.credentials.access,
        signal: request.signal,
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      });
      if (deps.onTurn !== undefined) await deps.onTurn({ request, result, envelope: loaded.envelope });
      return mapProductionTurnToDispatch(result, loaded);
    },
  };
}

export async function admitProductionPayload(input: {
  readonly envelope: ProductionEnvelope;
  readonly request: Omit<BudgetRequest, "requestPayloadHash" | "wireBodyBytes" | "textContextBytes">;
}): Promise<BudgetAdmission> {
  const includes = inspectProductionIncludes(input.envelope);
  const wireBody = JSON.stringify(input.envelope);
  const requestPayloadHash = await canonicalHash(input.envelope);
  const counter = input.request.counter.kind === "exact"
    ? { ...input.request.counter, requestPayloadHash, includes }
    : input.request.counter;
  return admitBudget({
    ...input.request,
    counter,
    requestPayloadHash,
    wireBodyBytes: bytesSchema.parse(Buffer.byteLength(wireBody, "utf8")),
    textContextBytes: bytesSchema.parse(Buffer.byteLength(wireBody, "utf8")),
  });
}

export function toGenerateResult(result: ProductionTurnResult, host: string, model: string): GenerateResult | null {
  switch (result.kind) {
    case "succeeded":
      return {
        text: result.text,
        usage: { promptTokenCount: result.usage.knownInputUsage, candidatesTokenCount: result.usage.knownOutputUsage },
        host,
        model,
      };
    case "missing-usage":
      return { text: result.text, host, model };
    case "incomplete":
    case "unknown":
    case "provider-context-exceeded":
    case "auth":
    case "quota":
    case "capability":
    case "cancelled":
      return null;
    default:
      return assertNever(result);
  }
}

export function toImageResult(result: ProductionTurnResult, host: string, model: string): ImageResult | null {
  if (result.kind !== "succeeded" && result.kind !== "missing-usage") return null;
  const images: InlineImage[] = [];
  const text: string[] = [];
  for (const part of result.replayParts) {
    const obj = readObject(part);
    if (obj === undefined) continue;
    if (typeof obj["text"] === "string") text.push(obj["text"]);
    const inline = readObject(obj["inlineData"]);
    const mimeType = inline?.["mimeType"];
    const data = inline?.["data"];
    if (typeof mimeType === "string" && typeof data === "string") images.push({ mimeType, data });
  }
  return {
    images,
    text,
    host,
    model,
    ...(result.kind === "succeeded"
      ? { usage: { promptTokenCount: result.usage.knownInputUsage, candidatesTokenCount: result.usage.knownOutputUsage } }
      : {}),
  };
}

