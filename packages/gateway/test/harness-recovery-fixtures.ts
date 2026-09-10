import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { PRODUCTION_TEXT_MODEL_ID } from "../src/cca/capabilities.js";
import { buildProductionRequest, createProductionDispatch } from "../src/cca/production.js";
import { createHarnessService } from "../src/harness/service.js";
import {
  createProductionRunner, hashSchema, type ProductionRunner, type ProviderDispatch,
  type ProviderDispatchRequest, type ProviderDispatchResult, type Run, type RunnerEvent, type StepReceipt,
  type TokenCounterPort,
} from "../../harness/src/index.js";
import { SqliteRunnerStore } from "../../harness/src/runner-sqlite.js";
import {
  HASH, chainedUnits, exactCounterPort, idleRun, mutableClock, outputsFor, productionCapability, sequentialIds,
  startCommand,
} from "./harness-runner-fixtures.js";
import { oauthProjectId } from "./harness-http-fixtures.js";

export type FixtureMode = "success" | "quota" | "auth" | "disconnect" | "error";
export type MatrixCounts = {
  readonly commits: number;
  readonly effects: number;
  readonly succeeded: number;
  readonly unknown: number;
  readonly failed: number;
  readonly intent: number;
  readonly providerCalls: number;
  readonly ready: number;
  readonly status: string;
  readonly reason: string | null;
};

export function countingCounter(inner: TokenCounterPort = exactCounterPort()): TokenCounterPort & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() { return calls; },
    count(input) { calls += 1; return inner.count(input); },
  };
}

export function scriptedDispatch(
  reply: (request: ProviderDispatchRequest) => ProviderDispatchResult | Promise<ProviderDispatchResult>,
): ProviderDispatch & { readonly calls: number } {
  const unitIds: string[] = [];
  return {
    get calls() { return unitIds.length; },
    async dispatch(request) {
      unitIds.push(request.unitId);
      return reply(request);
    },
  };
}

export function successDispatch(): ProviderDispatch & { readonly calls: number } {
  return scriptedDispatch(request => ({
    kind: "succeeded",
    artifact: { artifactId: request.effectId, hash: hashSchema.parse(outputsFor(request.unitId)), bytes: 8 },
    usage: { knownInputUsage: 11, knownOutputUsage: 7 },
  }));
}

export function waitRunner<T>(
  runner: ProductionRunner, pick: (event: RunnerEvent) => T | undefined, signal = AbortSignal.timeout(5000),
): Promise<T> {
  return new Promise((resolve, reject) => {
    const off = runner.subscribe(event => {
      const value = pick(event);
      if (value !== undefined) { off(); resolve(value); }
    });
    const abort = (): void => { off(); reject(signal.reason); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function waitStep(runner: ProductionRunner, stop: StepReceipt["stopReason"]): Promise<StepReceipt> {
  return waitRunner(runner, event => event.type === "step" && event.receipt.stopReason === stop ? event.receipt : undefined);
}

export function waitStatus(runner: ProductionRunner, status: Run["state"]["status"]): Promise<Run> {
  return waitRunner(runner, event => event.type === "state" && event.run.state.status === status ? event.run : undefined);
}

export function matrixCounts(runner: ProductionRunner, runId: string, providerCalls: number): MatrixCounts {
  const snapshot = runner.getSnapshot(runId);
  const run = snapshot.run;
  return {
    commits: run.version,
    effects: snapshot.effects.length,
    succeeded: snapshot.effects.filter(row => row.state === "succeeded").length,
    unknown: snapshot.effects.filter(row => row.state === "unknown").length,
    failed: snapshot.effects.filter(row => row.state === "known-failed").length,
    intent: snapshot.effects.filter(row => row.state === "intent").length,
    providerCalls,
    ready: run.units.filter(unit => unit.status === "ready").length,
    status: run.state.status,
    reason: run.state.status === "paused" ? run.state.reason : null,
  };
}

export async function listenFixtureHttp(script: { mode: FixtureMode }): Promise<{
  readonly origin: string;
  readonly close: () => Promise<void>;
  readonly requests: () => number;
}> {
  let requests = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests += 1;
    void (async () => {
      for await (const _chunk of req) { /* drain */ }
      switch (script.mode) {
        case "quota": res.writeHead(429).end(); return;
        case "auth": res.writeHead(401).end(); return;
        case "error": res.writeHead(500).end(); return;
        case "disconnect":
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write("data: {\"response\":{}}\n\n");
          res.destroy();
          return;
        case "success":
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`data: ${JSON.stringify({
            response: {
              candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
            },
          })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        default: res.writeHead(404).end();
      }
    })().catch(() => { res.destroy(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("fixture-port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests: () => requests,
    close: () => new Promise((done, fail) => {
      server.closeAllConnections();
      server.close(error => { if (error) fail(error); else done(); });
    }),
  };
}

export async function httpFixtureDispatch(script: { mode: FixtureMode }, clock: { now: () => number }, creds: {
  readonly expires: number; readonly refresh?: (token: string) => Promise<{ access_token: string; expires_in: number }>;
}): Promise<{
  readonly dispatch: ProviderDispatch & { readonly calls: number };
  readonly close: () => Promise<void>;
  readonly refreshes: () => number;
  readonly httpRequests: () => number;
}> {
  const http = await listenFixtureHttp(script);
  let refreshes = 0;
  const inner = createProductionDispatch({
    host: http.origin, clock, store: createMemoryStore({
      refresh: "fixture-refresh", access: "fixture-access", expires: creds.expires, projectId: oauthProjectId, email: "u@example.com",
    }),
    refresh: async token => {
      refreshes += 1;
      if (creds.refresh) return creds.refresh(token);
      return { access_token: "fixture-access-2", expires_in: 3600 };
    },
    loadTurn: async request => {
      const built = buildProductionRequest({
        projectId: "fixture-project", model: PRODUCTION_TEXT_MODEL_ID, kind: "text",
        requestId: request.effectId, contents: [{ role: "user", parts: [{ text: request.unitId }] }],
      });
      if (built.kind !== "ok") throw new Error(built.reason);
      return {
        envelope: built.envelope, artifactId: request.effectId,
        hash: hashSchema.parse(outputsFor(request.unitId)), bytes: 8,
      };
    },
  });
  const dispatch = scriptedDispatch(request => inner.dispatch(request));
  return {
    dispatch, close: http.close, refreshes: () => refreshes, httpRequests: http.requests,
  };
}

export async function withSqliteEnv<T>(
  options: {
    readonly dispatch?: ProviderDispatch & { readonly calls: number };
    readonly counter?: TokenCounterPort;
    readonly ids?: ReturnType<typeof sequentialIds>;
  },
  body: (env: {
    readonly store: SqliteRunnerStore;
    readonly runner: ProductionRunner;
    readonly dispatch: ProviderDispatch & { readonly calls: number };
    readonly clock: ReturnType<typeof mutableClock>;
    readonly ids: ReturnType<typeof sequentialIds>;
    readonly counter: TokenCounterPort & { readonly calls?: number };
    readonly app: ReturnType<typeof createApp>;
    readonly harness: ReturnType<typeof createHarnessService>;
  }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "vnmaker-t24-"));
  const store = new SqliteRunnerStore(dir);
  const clock = mutableClock(0);
  const ids = options.ids ?? sequentialIds();
  const dispatch = options.dispatch ?? successDispatch();
  const counter = options.counter ?? countingCounter();
  const runner = createProductionRunner({
    store, dispatch, clock, ids, capability: productionCapability(), counter,
  });
  const harness = createHarnessService({ runner, store, ids, clock, dispatchCount: () => dispatch.calls });
  const app = createApp({
    store: createMemoryStore({
      refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: oauthProjectId, email: "u@example.com",
    }),
    harness,
  });
  try {
    return await body({ store, runner, dispatch, clock, ids, counter, app, harness });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

export async function startScopedRun(
  runner: ProductionRunner, ids: ReturnType<typeof sequentialIds>, units = chainedUnits(),
): Promise<Run> {
  const created = await runner.create(ids.uuid(), idleRun(units));
  const running = waitStatus(runner, "running");
  await runner.apply(created.id, startCommand(created, units.map(unit => unit.id), ids.uuid()));
  return running;
}

export { HASH, chainedUnits, idleRun, sequentialIds, startCommand };
