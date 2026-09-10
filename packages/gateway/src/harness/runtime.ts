import {
  DEFAULT_BUDGET_LIMITS, MemoryRunnerStore, capabilityBindingSchema, createProductionRunner,
} from "../../../harness/src/index.js";
import type {
  BudgetLimits, CapabilityBinding, ProductionRunner, ProviderDispatch, RunnerClock, RunnerIds,
  RunnerStore, TokenCounterPort,
} from "../../../harness/src/index.js";
import type { CredentialStore } from "../auth/credentials.js";
import { createMemoryStore } from "../auth/credentials.js";
import { createFileProofStore } from "../auth/proofs.js";
import type { CapabilityProofStore } from "../auth/proofs.js";
import { refreshAccessToken } from "../auth/tokens.js";
import type { AuthState, CapabilityProof, CapabilityReport, CounterObservation } from "../cca/capabilities.js";
import { productionCatalogue, productionConfigDigest } from "../cca/capability-context.js";
import type { ModelEntry } from "../cca/client.js";
import { CCA_HOSTS } from "../config.js";
import { createSingleFlightAccess } from "../cca/production-auth.js";
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
  readonly counters?: readonly CounterObservation[];
  readonly proofStore?: CapabilityProofStore;
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
  const stored = deps.proofs !== undefined
    ? { proofs: deps.proofs, counters: deps.counters ?? [] }
    : await (deps.proofStore ?? createFileProofStore()).read();
  const proofs = stored.proofs;
  const counters = stored.counters;
  const models = deps.models ?? productionCatalogue();
  const configDigest = deps.configDigest ?? productionConfigDigest();
  const turns = deps.turns ?? createMemoryTurnStore();
  const limits = deps.limits ?? DEFAULT_BUDGET_LIMITS;
  const refresh = deps.refresh ?? refreshAccessToken;
  try {
    await createSingleFlightAccess({ store: credentialStore, clock, refresh }).ensureFreshAccess();
  } catch { /* dispatch surfaces auth */ }
  const credentials = await credentialStore.read();
  const resolved = resolveHarnessCapabilities({
    credentials, now: clock.now(), proofs, models, configDigest, counters,
  });
  const capability = capabilityBindingSchema.parse(runnerBinding(resolved.report));
  const dispatch = deps.dispatch ?? (credentials !== null
    ? createHarnessDispatch({
      host: deps.host ?? CCA_HOSTS[0],
      credentialStore, clock, refresh, store, turns, proofs, counters, models, configDigest, limits,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    })
    : createBlockedDispatch(async (request) => {
      const current = await credentialStore.read();
      const next = resolveHarnessCapabilities({
        credentials: current, now: clock.now(), proofs, models, configDigest, counters,
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
