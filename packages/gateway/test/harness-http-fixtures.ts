import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { createHarnessService } from "../src/harness/service.js";
import {
  DEFAULT_BUDGET_LIMITS, capabilityBindingSchema, parseRun, revisionSchema,
} from "../../harness/src/index.js";
import type { ProductionRunner, Run, RunnerStore, Unit } from "../../harness/src/index.js";
import { capability, hash, head, productionDocument, script } from "../../harness/test/fixtures.js";
import {
  HASH, IDS, idleRun, makeRunner, pendingUnit, productionCapability, recordingDispatch, sequentialIds,
} from "./harness-runner-fixtures.js";

export const studioHeaders = {
  "content-type": "application/json",
  "x-vnmaker-studio": "1",
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
} as const;
export const oauthProjectId = "aicode-consumers";
export const twoSceneScript = {
  ...script,
  scenes: [
    { id: "start", background: "title", lines: [{ id: "l-a", speaker: null, text: "Hello" }], next: "ch02" },
    { id: "ch02", background: "title", lines: [{ id: "l-b", speaker: null, text: "Later" }], ending: "End" },
  ],
} as const;

export function planCreateBody(requestId: string, extra: Record<string, unknown> = {}) {
  return {
    requestId, sourceHead: head, script: twoSceneScript, productionDocument,
    limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only", initialScope: "plan",
    brief: "Novel", targetMinutes: 240, ...extra,
  };
}

export function makeHarnessGateway() {
  const dispatch = recordingDispatch();
  const made = makeRunner({
    dispatch,
    capability: capabilityBindingSchema.parse({ ...capability, providerProjectId: "oauth-provider-project-id" }),
  });
  const harness = createHarnessService({
    runner: made.runner, store: made.store, ids: made.ids, clock: made.clock,
    dispatchCount: () => dispatch.calls,
  });
  const app = createApp({
    store: createMemoryStore({
      refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: oauthProjectId, email: "u@example.com",
    }),
    harness,
  });
  return { app, dispatch, harness, ...made };
}

export function listenApp(app: { fetch: typeof fetch }): Promise<{ origin: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, info => {
      resolve({
        origin: `http://127.0.0.1:${info.port}`,
        close: () => new Promise((done, fail) => {
          (server as Server).close(error => { if (error) fail(error); else done(); });
        }),
      });
    });
    (server as Server).once("error", reject);
  });
}

export type SseEvent = { readonly seq: number; readonly type: string; readonly data: unknown };
export async function readSseEvents(res: Response, min: number): Promise<readonly SseEvent[]> {
  if (res.body === null) throw new Error("no-body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: SseEvent[] = [];
  while (events.length < min) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const parsed = parseSse(part);
      if (parsed !== null) events.push(parsed);
    }
  }
  await reader.cancel();
  return events;
}
function parseSse(block: string): SseEvent | null {
  let id = ""; let event = "message"; let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (id === "" && data === "") return null;
  return { seq: Number(id), type: event, data: data === "" ? null : JSON.parse(data) as unknown };
}

export async function jsonRequest(
  app: { request: (path: string, init?: RequestInit) => Promise<Response> },
  path: string, init: RequestInit = {},
): Promise<{ readonly status: number; readonly body: Record<string, unknown>; readonly text: string }> {
  const res = await app.request(path, { ...init, headers: { ...studioHeaders, ...init.headers } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { raw: text }; }
  return { status: res.status, body, text };
}

export function readyUnit(id: string, sceneId: string): Unit {
  const base = pendingUnit(id, "scene-draft", []);
  return {
    ...base, status: "ready",
    provenance: {
      originHead: head, inputContentHash: HASH.a,
      readSet: [{ kind: "entity", target: { kind: "scene", sceneId }, hash: HASH.a }],
      writeSet: [{ target: { kind: "scene", sceneId }, fields: ["lines"] }],
      outputArtifactHash: HASH.out1, modelBindingHash: HASH.b, referenceBindingHashes: [],
    },
  };
}

export function snapshotFor(run: Run, runnerMeta: ReturnType<typeof productionCapability> extends never ? never : object) {
  void runnerMeta;
  return {
    run, meta: {
      scopeUnitIds: run.units.map(unit => unit.id), chapterId: "ch1",
      capabilityBindingHash: hash, accountScope: "fixture-account",
      providerProjectId: "oauth-provider-project-id", holderId: IDS.holder,
      boundedPayloadApproved: false, authorizedReplacements: [] as const, leaseScopeHash: hash,
    },
    effects: [] as const, used: { run: { textAttempts: 0, imageAttempts: 0, countRequests: 0 }, chapters: [] as const },
  };
}

export function seedIdle(store: RunnerStore, units: readonly Unit[], id = IDS.run): Run {
  const run = parseRun({ ...idleRun(units), id });
  store.save(snapshotFor(run, {}));
  return run;
}

export function seedState(store: RunnerStore, run: Run, state: Run["state"], extra: Partial<Run> = {}): Run {
  const next = parseRun({
    ...run, ...extra, state, version: revisionSchema.parse(run.version + 1), lastEventSeq: run.lastEventSeq + 1,
  });
  const previous = store.load(run.id);
  if (previous === null) throw new Error("missing-run");
  store.save({ ...previous, run: next });
  return next;
}

export { HASH, IDS, sequentialIds, idleRun, makeRunner, recordingDispatch, head, hash, productionDocument };
export type { ProductionRunner, Run };
