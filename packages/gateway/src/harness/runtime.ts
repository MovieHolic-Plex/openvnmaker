import {
  DEFAULT_BUDGET_LIMITS, MemoryRunnerStore, capabilityBindingSchema, createProductionRunner,
} from "../../../harness/src/index.js";
import type {
  BudgetLimits, CapabilityBinding, ProductionRunner, ProviderDispatch, RunnerClock, RunnerIds,
  RunnerStore, TokenCounterPort,
} from "../../../harness/src/index.js";
import type { CredentialStore } from "../auth/credentials.js";
import { createMemoryStore } from "../auth/credentials.js";
import {
  PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID,
} from "../cca/capabilities.js";
import type { AuthState, CapabilityProof, CapabilityReport } from "../cca/capabilities.js";
import { mapModels } from "../cca/client.js";
import type { ModelEntry } from "../cca/client.js";
import { CCA_HOSTS } from "../config.js";
import type { TokenRefreshResponse } from "../cca/production.js";
import { createHarnessService } from "./service.js";
import type { HarnessService } from "./service.js";
import {
  blockedDispatchResult, createBlockedDispatch, resolveHarnessCapabilities, runnerBinding,
} from "./capability-runtime.js";
import { createHarnessDispatch } from "./production-dispatch.js";
import { createMemoryTurnStore } from "./turn-context.js";
import type { ProductionTurnStore } from "./turn-context.js";

const unsupportedCounter: TokenCounterPort = { count: () => ({ kind: "unsupported" }) };
const wallClock: RunnerClock = { now: () => Date.now() };
const ids = { uuid: () => globalThis.crypto.randomUUID() };

function productionModels(): readonly ModelEntry[] {
  return mapModels({
    [PRODUCTION_TEXT_MODEL_ID]: { supportsImages: true },
    [PRODUCTION_IMAGE_MODEL_ID]: { supportsImages: true },
  });
}

export type DefaultHarnessDeps = {
  readonly credentialStore?: CredentialStore;
  readonly store?: RunnerStore;
  readonly clock?: RunnerClock;
  readonly ids?: RunnerIds;
  readonly dispatch?: ProviderDispatch;
  readonly fetch?: typeof fetch;
  readonly host?: string;
  readonly refresh?: (refreshToken: string) => Promise<TokenRefreshResponse>;
  readonly proofs?: readonly CapabilityProof[];
  readonly models?: readonly ModelEntry[];
  readonly turns?: ProductionTurnStore;
  readonly counter?: TokenCounterPort;
  readonly configDigest?: string;
  readonly limits?: BudgetLimits;
};

export type DefaultHarnessRuntime = {
  readonly service: HarnessService;
  readonly runner: ProductionRunner;
  readonly store: RunnerStore;
  readonly dispatch: ProviderDispatch;
  readonly capability: CapabilityBinding;
  readonly report: CapabilityReport;
  readonly auth: AuthState;
};

export async function createDefaultHarnessRuntime(deps: DefaultHarnessDeps = {}): Promise<DefaultHarnessRuntime> {
  const credentialStore = deps.credentialStore ?? createMemoryStore(null);
  const store = deps.store ?? new MemoryRunnerStore();
  const clock = deps.clock ?? wallClock;
  const runnerIds = deps.ids ?? ids;
  const proofs = deps.proofs ?? [];
  const models = deps.models ?? productionModels();
  const configDigest = deps.configDigest ?? "0".repeat(64);
  const turns = deps.turns ?? createMemoryTurnStore();
  const limits = deps.limits ?? DEFAULT_BUDGET_LIMITS;
  const credentials = await credentialStore.read();
  const resolved = resolveHarnessCapabilities({
    credentials, now: clock.now(), proofs, models, configDigest,
  });
  const capability = capabilityBindingSchema.parse(runnerBinding(resolved.report));
  const ready = capability.ready;
  const refresh = deps.refresh ?? (async () => { throw new Error("oauth-refresh-forbidden"); });
  const dispatch = deps.dispatch ?? (ready
    ? createHarnessDispatch({
      host: deps.host ?? CCA_HOSTS[0],
      credentialStore, clock, refresh, store, turns, proofs, models, configDigest, limits,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    })
    : createBlockedDispatch(async (request) => {
      const current = await credentialStore.read();
      const next = resolveHarnessCapabilities({
        credentials: current, now: clock.now(), proofs, models, configDigest,
      });
      return blockedDispatchResult(next.auth, next.report, request.kind) ?? { kind: "capability" };
    }));
  const runner = createProductionRunner({
    store, dispatch, clock, ids: runnerIds, capability, counter: deps.counter ?? unsupportedCounter,
  });
  return {
    service: createHarnessService({ runner, store, ids: runnerIds, clock, dispatchCount: () => 0 }),
    runner, store, dispatch, capability, report: resolved.report, auth: resolved.auth,
  };
}

export async function createDefaultHarnessService(deps: DefaultHarnessDeps = {}): Promise<HarnessService> {
  return (await createDefaultHarnessRuntime(deps)).service;
}
