import {
  capabilityBindingSchema, createProductionRunner, MemoryRunnerStore,
} from "../../../harness/src/index.js";
import type { ProviderDispatch, RunnerClock, TokenCounterPort } from "../../../harness/src/index.js";
import { createHarnessService } from "./service.js";
import type { HarnessService } from "./service.js";

const silentDispatch: ProviderDispatch = { dispatch: async () => ({ kind: "capability" }) };
const unsupportedCounter: TokenCounterPort = { count: () => ({ kind: "unsupported" }) };
const wallClock: RunnerClock = { now: () => Date.now() };
const ids = { uuid: () => globalThis.crypto.randomUUID() };

export function createDefaultHarnessService(): HarnessService {
  const store = new MemoryRunnerStore();
  const runner = createProductionRunner({
    store, dispatch: silentDispatch, clock: wallClock, ids,
    capability: capabilityBindingSchema.parse({
      accountScope: "local-studio", providerProjectId: "unconfigured", modelId: "gemini-3.8-flash-high",
      configDigest: "0".repeat(64), evidenceHash: "1".repeat(64), counterSupport: "unsupported",
      tokenWindowMode: "unknown", inputTokenLimit: null, outputTokenLimit: null, combinedTokenLimit: null, ready: false,
    }),
    counter: unsupportedCounter,
  });
  return createHarnessService({ runner, store, ids, clock: wallClock, dispatchCount: () => 0 });
}
