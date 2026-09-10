import assert from "node:assert/strict";
import { test } from "node:test";
import { PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID } from "../src/cca/capabilities.js";
import { createMemoryTurnStore } from "../src/harness/turn-context.js";
import { createDefaultHarnessRuntime } from "../src/harness/runtime.js";
import type { DefaultHarnessDeps } from "../src/harness/runtime.js";
import { parseRun } from "../../harness/src/index.js";
import {
  IDS, idleRun, pendingUnit, sequentialIds, startCommand, waitForState,
} from "./harness-runner-fixtures.js";
import {
  WIRE_DIGEST, countingFetch, credentialStore, expectedReplay, forbiddenFetch, imageProof,
  listenWireHttp, readModelParts, textProof, tinyWireLimits, wireCredentials, wireModels, wireRequest,
} from "./harness-wire-fixtures.js";

function readyDeps(input: {
  readonly host?: string;
  readonly fetch?: typeof fetch;
  readonly proofs?: "both" | "text" | "none";
  readonly credentials?: ReturnType<typeof wireCredentials> | null;
  readonly turns?: ReturnType<typeof createMemoryTurnStore>;
  readonly limits?: ReturnType<typeof tinyWireLimits>;
}): DefaultHarnessDeps {
  const proofs = input.proofs === "none" || input.proofs === undefined
    ? input.proofs === "none" ? [] : [textProof(), imageProof()]
    : input.proofs === "text" ? [textProof()] : [textProof(), imageProof()];
  return {
    credentialStore: credentialStore(input.credentials === undefined ? wireCredentials() : input.credentials),
    proofs,
    models: wireModels(),
    configDigest: WIRE_DIGEST,
    host: input.host ?? "http://127.0.0.1:9",
    refresh: async () => ({ access_token: "fixture-access", expires_in: 3600 }),
    ...(input.fetch === undefined ? { fetch: forbiddenFetch() } : { fetch: input.fetch }),
    ...(input.turns === undefined ? {} : { turns: input.turns }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
  };
}

test("text-unit-routes-to-text-model-and-succeeds", async (t) => {
  const http = await listenWireHttp(() => "success");
  t.after(() => http.close());
  const fetches = { count: 0 };
  const ids = sequentialIds();
  const runtime = await createDefaultHarnessRuntime({
    ...readyDeps({ host: http.origin, fetch: countingFetch(fetches) }),
    ids,
  });
  assert.equal(runtime.capability.ready, true);
  assert.equal(runtime.capability.modelId, PRODUCTION_TEXT_MODEL_ID);
  const created = await runtime.runner.create(
    ids.uuid(),
    parseRun({ ...idleRun([pendingUnit(IDS.u1, "outline", [])]), tokenPolicy: "bounded-payload" }),
  );
  const running = waitForState(runtime.runner, (run) => run.state.status === "running");
  await runtime.runner.apply(created.id, startCommand(created, [IDS.u1], ids.uuid()));
  await running;
  const step = await runtime.runner.pump(created.id);
  assert.equal(step.stopReason, "unit-ready");
  assert.equal(http.models()[0], PRODUCTION_TEXT_MODEL_ID);
  assert.equal(fetches.count, 1);
});

test("image-unit-routes-to-image-model", async (t) => {
  const http = await listenWireHttp(() => "success");
  t.after(() => http.close());
  const fetches = { count: 0 };
  const runtime = await createDefaultHarnessRuntime(
    readyDeps({ host: http.origin, fetch: countingFetch(fetches) }),
  );
  const result = await runtime.dispatch.dispatch(wireRequest("image", IDS.u2));
  assert.equal(result.kind, "succeeded");
  assert.equal(http.models()[0], PRODUCTION_IMAGE_MODEL_ID);
  assert.notEqual(http.models()[0], PRODUCTION_TEXT_MODEL_ID);
  assert.equal(fetches.count, 1);
});

test("image-unit-attempted-on-text-model-is-blocked", async () => {
  const fetches = { count: 0 };
  const textOnly = await createDefaultHarnessRuntime(
    readyDeps({ proofs: "text", fetch: countingFetch(fetches) }),
  );
  const blocked = await textOnly.dispatch.dispatch(wireRequest("image", IDS.u2));
  assert.equal(blocked.kind, "capability");
  assert.equal(fetches.count, 0);

  const turns = createMemoryTurnStore([{
    runId: IDS.run,
    unitId: IDS.u2,
    context: {
      contents: [{ role: "user", parts: [{ text: "draw the lantern" }] }],
      model: PRODUCTION_TEXT_MODEL_ID,
    },
  }]);
  const forced = await createDefaultHarnessRuntime(readyDeps({ proofs: "both", fetch: countingFetch(fetches), turns }));
  const mismatch = await forced.dispatch.dispatch(wireRequest("image", IDS.u2));
  assert.equal(mismatch.kind, "capability");
  assert.equal(fetches.count, 0);
});

test("missing-credentials-yield-auth", async () => {
  const runtime = await createDefaultHarnessRuntime(
    readyDeps({ credentials: null, proofs: "both", fetch: forbiddenFetch() }),
  );
  assert.equal(runtime.capability.ready, false);
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "auth");
});

test("unverified-capability-yields-capability", async () => {
  const runtime = await createDefaultHarnessRuntime(
    readyDeps({ proofs: "none", fetch: forbiddenFetch() }),
  );
  assert.equal(runtime.capability.ready, false);
  assert.equal(runtime.report.text.text.status, "unverified");
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "capability");
});

test("budget-denial-blocks-before-dispatch", async () => {
  const runtime = await createDefaultHarnessRuntime(
    readyDeps({ proofs: "both", fetch: forbiddenFetch(), limits: tinyWireLimits() }),
  );
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "capability");
});

test("429-maps-to-quota", async (t) => {
  const http = await listenWireHttp(() => "quota");
  t.after(() => http.close());
  const fetches = { count: 0 };
  const runtime = await createDefaultHarnessRuntime(
    readyDeps({ host: http.origin, fetch: countingFetch(fetches) }),
  );
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "quota");
  assert.equal(fetches.count, 1);
  assert.equal(http.requests(), 1);
});

test("stream-disconnect-maps-to-unknown-and-is-not-retried", async (t) => {
  const http = await listenWireHttp(() => "disconnect");
  t.after(() => http.close());
  const fetches = { count: 0 };
  const runtime = await createDefaultHarnessRuntime(
    readyDeps({ host: http.origin, fetch: countingFetch(fetches) }),
  );
  const result = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(result.kind, "unknown");
  assert.equal(fetches.count, 1);
  assert.equal(http.requests(), 1);
});

test("opaque-parts-from-turn-1-replay-byte-equivalently-on-turn-2", async (t) => {
  let n = 0;
  const http = await listenWireHttp(() => {
    n += 1;
    return n === 1 ? "opaque" : "success";
  });
  t.after(() => http.close());
  const fetches = { count: 0 };
  const turns = createMemoryTurnStore([{
    runId: IDS.run,
    unitId: IDS.u1,
    context: {
      contents: [{ role: "user", parts: [{ text: "draft the lab" }] }],
      tools: [{ functionDeclarations: [{ name: "patch_lines" }, { name: "read_scene" }] }],
    },
  }]);
  const runtime = await createDefaultHarnessRuntime(
    readyDeps({ host: http.origin, fetch: countingFetch(fetches), turns }),
  );
  const first = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(first.kind, "succeeded");
  const second = await runtime.dispatch.dispatch(wireRequest("outline"));
  assert.equal(second.kind, "succeeded");
  const bodies = http.bodies();
  assert.equal(bodies.length, 2);
  const replayed = bodies[1];
  assert.ok(replayed !== undefined);
  assert.equal(JSON.stringify(readModelParts(replayed)), JSON.stringify(expectedReplay));
  assert.equal(fetches.count, 2);
});
