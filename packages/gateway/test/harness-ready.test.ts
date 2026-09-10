import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryProofStore } from "../src/auth/proofs.js";
import { PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID } from "../src/cca/capabilities.js";
import { mapModels } from "../src/cca/client.js";
import { createDefaultHarnessRuntime } from "../src/harness/runtime.js";
import {
  admitBudget, budgetRequestSchema, canonicalHash, DEFAULT_BUDGET_LIMITS,
} from "../../harness/src/index.js";
import { budgetInput, exactCounter, hash } from "../../harness/test/fixtures.js";
import { exactCounterPort } from "./harness-runner-fixtures.js";
import {
  countingFetch, forbiddenFetch, imageProof, listenWireHttp, textProof, WIRE_DIGEST,
  wireCredentials, wireModels, wireRequest,
} from "./harness-wire-fixtures.js";
import { createMemoryStore } from "../src/auth/credentials.js";

function countingModels() {
  return mapModels({
    [PRODUCTION_TEXT_MODEL_ID]: {
      supportsImages: true, inputTokenLimit: 100000, outputTokenLimit: 8192, tokenWindowMode: "input-only",
    },
    [PRODUCTION_IMAGE_MODEL_ID]: {
      supportsImages: true, inputTokenLimit: 100000, outputTokenLimit: 8192, tokenWindowMode: "input-only",
    },
  });
}

function blockCode(feature: { readonly status: string; readonly block?: { readonly code: string } }): string | null {
  return feature.status === "blocked" ? feature.block?.code ?? null : null;
}

async function runtimeFromStore(input: {
  readonly proofs?: Parameters<typeof createMemoryProofStore>[0];
  readonly credentials?: ReturnType<typeof wireCredentials> | null;
  readonly configDigest?: string;
  readonly models?: ReturnType<typeof wireModels>;
  readonly fetch?: typeof fetch;
  readonly host?: string;
  readonly refresh?: (token: string) => Promise<{ access_token: string; expires_in: number }>;
  readonly clock?: { now: () => number };
  readonly counter?: ReturnType<typeof exactCounterPort>;
}) {
  const proofStore = createMemoryProofStore(input.proofs ?? { proofs: [], counters: [] });
  return createDefaultHarnessRuntime({
    credentialStore: createMemoryStore(input.credentials === undefined ? wireCredentials() : input.credentials),
    proofStore,
    models: input.models ?? wireModels(),
    configDigest: input.configDigest ?? WIRE_DIGEST,
    host: input.host ?? "http://127.0.0.1:9",
    refresh: input.refresh ?? (async () => ({ access_token: "fixture-access", expires_in: 3600 })),
    fetch: input.fetch ?? forbiddenFetch(),
    ...(input.clock === undefined ? {} : { clock: input.clock }),
    ...(input.counter === undefined ? {} : { counter: input.counter }),
  });
}

test("stored matching proof makes the dispatch path ready", async (t) => {
  const http = await listenWireHttp(() => "success");
  t.after(() => http.close());
  const fetches = { count: 0 };
  const runtime = await runtimeFromStore({
    proofs: { proofs: [textProof(), imageProof()], counters: [] },
    host: http.origin, fetch: countingFetch(fetches),
  });
  assert.equal(runtime.capability.ready, true);
  assert.equal(runtime.report.productionReady, true);
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "succeeded");
  assert.equal(fetches.count, 1);
});

test("stored proof with a different contextHash yields PROBE_STALE and stays blocked", async () => {
  const staleText = { ...textProof(), contextHash: "1".repeat(64) };
  const runtime = await runtimeFromStore({ proofs: { proofs: [staleText], counters: [] } });
  assert.equal(blockCode(runtime.report.text.text), "PROBE_STALE");
  assert.equal(runtime.capability.ready, false);
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "capability");
});

test("changing account or model invalidates the stored proof", async () => {
  const stored = { proofs: [textProof(), imageProof()], counters: [] };
  const account = await runtimeFromStore({
    proofs: stored, credentials: { ...wireCredentials(), email: "account-b" },
  });
  assert.equal(blockCode(account.report.text.text), "PROBE_STALE");
  assert.equal(account.capability.ready, false);
  assert.equal((await account.dispatch.dispatch(wireRequest("outline"))).kind, "capability");
  const config = await runtimeFromStore({ proofs: stored, configDigest: "1".repeat(64) });
  assert.equal(blockCode(config.report.text.text), "PROBE_STALE");
  assert.equal(config.capability.ready, false);
  assert.equal((await config.dispatch.dispatch(wireRequest("outline"))).kind, "capability");
});

test("no stored proof keeps the path blocked with capability", async () => {
  const runtime = await runtimeFromStore({ proofs: { proofs: [], counters: [] } });
  assert.equal(runtime.report.text.text.status, "unverified");
  assert.equal(runtime.capability.ready, false);
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "capability");
});

test("expired access token triggers exactly one refresh and then succeeds", async (t) => {
  const http = await listenWireHttp(() => "success");
  t.after(() => http.close());
  const fetches = { count: 0 };
  let refreshes = 0;
  const runtime = await runtimeFromStore({
    proofs: { proofs: [textProof(), imageProof()], counters: [] },
    credentials: wireCredentials(1),
    clock: { now: () => 10_000 },
    host: http.origin, fetch: countingFetch(fetches),
    refresh: async () => {
      refreshes += 1;
      return { access_token: "fresh-access", expires_in: 3600 };
    },
  });
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "succeeded");
  assert.equal(refreshes, 1);
  assert.equal(fetches.count, 1);
});

test("failed refresh returns auth and does not loop", async () => {
  let refreshes = 0;
  let now = 10_000;
  const runtime = await runtimeFromStore({
    proofs: { proofs: [textProof(), imageProof()], counters: [] },
    credentials: wireCredentials(20_000),
    clock: { now: () => now },
    refresh: async () => {
      refreshes += 1;
      throw new Error("refresh-failed");
    },
  });
  now = 30_000;
  const first = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(first.kind, "auth");
  assert.equal(refreshes, 1);
  const second = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(second.kind, "auth");
  assert.equal(refreshes, 2);
});

test("concurrent dispatches share a single refresh", async (t) => {
  const http = await listenWireHttp(() => "success");
  t.after(() => http.close());
  let now = 10_000;
  let refreshes = 0;
  const gate = Promise.withResolvers<void>();
  const runtime = await runtimeFromStore({
    proofs: { proofs: [textProof(), imageProof()], counters: [] },
    credentials: wireCredentials(20_000),
    clock: { now: () => now },
    host: http.origin, fetch: countingFetch({ count: 0 }),
    refresh: async () => {
      refreshes += 1;
      await gate.promise;
      return { access_token: "fresh-access", expires_in: 3600 };
    },
  });
  now = 30_000;
  const first = runtime.dispatch.dispatch(wireRequest("outline"));
  const second = runtime.dispatch.dispatch(wireRequest("outline"));
  gate.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(refreshes, 1);
  assert.equal(results[0]?.kind, "succeeded");
  assert.equal(results[1]?.kind, "succeeded");
});

test("provider reporting exact usage makes exact-only admissible", async () => {
  const contextHash = textProof().contextHash;
  const runtime = await runtimeFromStore({
    proofs: {
      proofs: [textProof(), imageProof()],
      counters: [
        { modelId: PRODUCTION_TEXT_MODEL_ID, contextHash, exactUsage: true },
        { modelId: PRODUCTION_IMAGE_MODEL_ID, contextHash, exactUsage: true },
      ],
    },
    models: countingModels(),
    counter: exactCounterPort(),
  });
  assert.equal(runtime.capability.counterSupport, "exact");
  assert.equal(runtime.capability.tokenWindowMode, "input-only");
  assert.equal(runtime.capability.inputTokenLimit, 100000);
  const capabilityBindingHash = await canonicalHash(runtime.capability);
  const admission = admitBudget(budgetRequestSchema.parse({
    ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, capability: runtime.capability, capabilityBindingHash,
    counter: { ...exactCounter, requestPayloadHash: hash, capabilityBindingHash, inputTokens: 100 },
    policy: "exact-only", boundedPayloadApproved: false,
  }));
  assert.equal(admission.allowed, true);
  assert.equal(admission.tokenCheck, "pass");
  assert.equal(admission.authorization, "exact-approved");
});

test("absent usage keeps exact-only refused", async () => {
  const runtime = await runtimeFromStore({
    proofs: { proofs: [textProof(), imageProof()], counters: [] },
    models: countingModels(),
    counter: exactCounterPort(),
  });
  assert.equal(runtime.capability.counterSupport, "unsupported");
  assert.equal(runtime.capability.tokenWindowMode, "input-only");
  const capabilityBindingHash = await canonicalHash(runtime.capability);
  const admission = admitBudget(budgetRequestSchema.parse({
    ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, capability: runtime.capability, capabilityBindingHash,
    counter: { ...exactCounter, requestPayloadHash: hash, capabilityBindingHash, inputTokens: 100 },
    policy: "exact-only", boundedPayloadApproved: false,
  }));
  assert.equal(admission.allowed, false);
  assert.equal(admission.tokenCheck, "unknown");
  assert.notEqual(admission.authorization, "exact-approved");
});
