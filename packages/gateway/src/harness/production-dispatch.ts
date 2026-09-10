import {
  admitProductionPayload, appendReplayTurn, buildProductionRequest, createProductionDispatch,
  validateProductionEnvelope,
} from "../cca/production.js";
import type { ProductionClock, ProductionEnvelope, TokenRefreshResponse } from "../cca/production.js";
import { createSingleFlightAccess } from "../cca/production-auth.js";
import type { CredentialStore } from "../auth/credentials.js";
import type { CapabilityProof, CounterObservation } from "../cca/capabilities.js";
import type { ModelEntry } from "../cca/client.js";
import {
  bytesSchema, canonicalHash, capabilityBindingSchema, type BudgetAdmission, type BudgetLimits, type CapabilityBinding,
  type ProviderDispatch, type ProviderDispatchRequest, type ProviderDispatchResult, type RunnerStore,
  type TokenCounterResult, type Unit,
} from "../../../harness/src/index.js";
import {
  blockedDispatchResult, modelIdForProductionKind, productionKindForUnit, resolveHarnessCapabilities,
} from "./capability-runtime.js";
import type { ProductionTurnStore } from "./turn-context.js";

export type HarnessDispatchDeps = {
  readonly host: string;
  readonly credentialStore: CredentialStore;
  readonly clock: ProductionClock;
  readonly refresh: (refreshToken: string) => Promise<TokenRefreshResponse>;
  readonly store: RunnerStore;
  readonly turns: ProductionTurnStore;
  readonly proofs: readonly CapabilityProof[];
  readonly counters?: readonly CounterObservation[];
  readonly models: readonly ModelEntry[];
  readonly configDigest: string;
  readonly limits: BudgetLimits;
  readonly fetch?: typeof fetch;
};

function defaultContents(request: ProviderDispatchRequest, unit: Unit | undefined): readonly unknown[] {
  const hash = unit?.contextManifest.inputContentHash ?? request.payloadHash;
  const kind = unit?.kind ?? request.kind;
  return [{ role: "user", parts: [{ text: `Produce ${kind} for ${hash}` }] }];
}

export type LoadedProductionTurn =
  | { readonly kind: "ok"; readonly envelope: ProductionEnvelope; readonly artifactId: string; readonly hash: string; readonly bytes: number }
  | { readonly kind: "capability"; readonly reason: "MODEL_MISMATCH" | "REQUEST_SIGNATURE" };

export async function loadProductionTurn(input: {
  readonly request: ProviderDispatchRequest;
  readonly store: RunnerStore;
  readonly turns: ProductionTurnStore;
  readonly projectId: string;
}): Promise<LoadedProductionTurn> {
  const productionKind = productionKindForUnit(input.request.kind);
  const routedModel = modelIdForProductionKind(productionKind);
  const stored = input.turns.load(input.request.runId, input.request.unitId);
  if (stored?.model !== undefined && stored.model !== routedModel) {
    return { kind: "capability", reason: "MODEL_MISMATCH" };
  }
  const snapshot = input.store.load(input.request.runId);
  const unit = snapshot === null ? undefined : snapshot.run.units.find((row) => row.id === input.request.unitId);
  const baseContents = stored?.contents ?? defaultContents(input.request, unit);
  const replay = stored?.replayParts ?? [];
  const contents = replay.length === 0
    ? baseContents
    : appendReplayTurn(baseContents, replay, stored?.functionResponses ?? []);
  const built = buildProductionRequest({
    projectId: input.projectId,
    model: routedModel,
    contents,
    requestId: input.request.effectId,
    kind: productionKind,
    ...(stored?.tools === undefined ? {} : { tools: stored.tools }),
    ...(input.request.admission.requestedOutputTokens > 0
      ? { maxOutputTokens: input.request.admission.requestedOutputTokens }
      : {}),
  });
  if (built.kind !== "ok") return { kind: "capability", reason: built.reason };
  const validated = validateProductionEnvelope(built.envelope);
  if (validated.kind !== "ok") return { kind: "capability", reason: validated.reason };
  return {
    kind: "ok",
    envelope: validated.envelope,
    artifactId: input.request.effectId,
    hash: await canonicalHash(validated.envelope),
    bytes: bytesSchema.parse(Buffer.byteLength(validated.wireBody, "utf8")),
  };
}

function budgetFields(
  capability: CapabilityBinding,
  limits: BudgetLimits,
  request: ProviderDispatchRequest,
): Parameters<typeof admitProductionPayload>[0]["request"] {
  const reserve = request.kind === "image"
    ? { textAttempts: 0, imageAttempts: 1, countRequests: 0 }
    : { textAttempts: 1, imageAttempts: 0, countRequests: 0 };
  return {
    capabilityBindingHash: request.admission.capabilityBindingHash,
    budgetGroupId: request.admission.budgetGroupId,
    limitVersion: request.admission.limitVersion,
    images: request.admission.images,
    requestedOutputTokens: request.admission.requestedOutputTokens,
    counter: tokenCounterFor(request, capability),
    capability,
    limits,
    policy: request.admission.policy,
    boundedPayloadApproved: request.admission.authorization === "bounded-payload-approved",
    unitAuthorized: true,
    used: {
      run: { textAttempts: 0, imageAttempts: 0, countRequests: 0 },
      chapter: { textAttempts: 0, imageAttempts: 0, countRequests: 0 },
    },
    reserve,
    autoRepairRound: 0,
  };
}

function dispatchFromAdmission(admission: BudgetAdmission): ProviderDispatchResult {
  const reason = admission.reason ?? "CAPABILITY_REQUIRED";
  if (reason === "AUTH_REQUIRED" || reason === "COUNTER_AUTH") return { kind: "auth" };
  if (reason === "QUOTA" || reason === "COUNTER_QUOTA") return { kind: "quota" };
  if (reason === "CONTEXT_LIMIT") return { kind: "context-limit" };
  return { kind: "capability" };
}

function tokenCounterFor(request: ProviderDispatchRequest, capability: CapabilityBinding): TokenCounterResult {
  const counted = request.admission.countedInputTokens;
  if (capability.counterSupport !== "exact" || request.admission.tokenCheck !== "pass" || counted === null) {
    return { kind: "unsupported" };
  }
  return {
    kind: "exact",
    requestPayloadHash: request.payloadHash,
    capabilityBindingHash: request.admission.capabilityBindingHash,
    inputTokens: counted,
    includes: { text: true, tools: true, history: true, opaque: true, images: request.admission.images.length > 0 },
  };
}

export function createHarnessDispatch(deps: HarnessDispatchDeps): ProviderDispatch {
  const access = createSingleFlightAccess({
    store: deps.credentialStore, clock: deps.clock, refresh: deps.refresh,
  });
  const inner = createProductionDispatch({
    host: deps.host,
    store: deps.credentialStore,
    clock: deps.clock,
    refresh: deps.refresh,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    loadTurn: async (request) => {
      const credentials = await deps.credentialStore.read();
      const loaded = await loadProductionTurn({
        request,
        store: deps.store,
        turns: deps.turns,
        projectId: credentials?.projectId ?? "unconfigured",
      });
      if (loaded.kind !== "ok") throw new Error(loaded.reason);
      return loaded;
    },
    onTurn: ({ request, result }) => {
      if (result.kind !== "succeeded" && result.kind !== "missing-usage") return;
      const prior = deps.turns.load(request.runId, request.unitId);
      const snapshot = deps.store.load(request.runId);
      const unit = snapshot === null ? undefined : snapshot.run.units.find((row) => row.id === request.unitId);
      deps.turns.save(request.runId, request.unitId, {
        contents: prior?.contents ?? defaultContents(request, unit),
        ...(prior?.tools === undefined ? {} : { tools: prior.tools }),
        replayParts: result.replayParts,
        functionResponses: result.calls.map((call) => ({ name: call.name, response: { ok: true } })),
      });
    },
  });
  return {
    async dispatch(request) {
      let credentials;
      try {
        const fresh = await access.ensureFreshAccess();
        if (fresh === null) return { kind: "auth" };
        credentials = fresh.credentials;
      } catch {
        return { kind: "auth" };
      }
      const resolved = resolveHarnessCapabilities({
        credentials,
        now: deps.clock.now(),
        proofs: deps.proofs,
        models: deps.models,
        configDigest: deps.configDigest,
        ...(deps.counters === undefined ? {} : { counters: deps.counters }),
      });
      const blocked = blockedDispatchResult(resolved.auth, resolved.report, request.kind);
      if (blocked !== null) return blocked;
      const loaded = await loadProductionTurn({
        request, store: deps.store, turns: deps.turns, projectId: credentials.projectId,
      });
      if (loaded.kind !== "ok") return { kind: "capability" };
      const productionKind = productionKindForUnit(request.kind);
      const capability = capabilityBindingSchema.parse(
        productionKind === "image" ? resolved.report.image.binding : resolved.report.text.binding,
      );
      const admission = await admitProductionPayload({
        envelope: loaded.envelope,
        request: budgetFields(capability, deps.limits, request),
      });
      if (!admission.allowed) return dispatchFromAdmission(admission);
      return inner.dispatch(request);
    },
  };
}
