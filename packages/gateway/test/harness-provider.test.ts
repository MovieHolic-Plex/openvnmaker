import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { test } from "node:test";
import { createMemoryStore } from "../src/auth/credentials.js";
import { PRODUCTION_TEXT_MODEL_ID } from "../src/cca/capabilities.js";
import {
  appendReplayTurn,
  buildProductionRequest,
  createIncrementalSseParser,
  createSingleFlightAccess,
  mapProductionTurnToDispatch,
  runProductionTurn,
} from "../src/cca/production.js";
import type { CompleteFunctionCall, ProductionTurnResult } from "../src/cca/production.js";

const encoder = new TextEncoder();
const HASH = "a".repeat(64);
const callArgs = { sceneId: "ch01-lab", note: "문 너머" } as const;
const expectedReplay = [
  {
    functionCall: { name: "patch_lines", id: "call-1", args: { sceneId: "ch01-lab", note: "문 너머" } },
    thoughtSignature: "sig-patch-lines/abc+def=",
    ccaTrace: "keep-this-bytewise",
  },
  {
    functionCall: { name: "read_scene", id: "call-2", args: { sceneId: "ch01-lab" } },
    thoughtSignature: "sig-read-scene/xyz=",
  },
] as const;

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

const thoughtEvent = {
  response: { candidates: [{ content: { parts: [{ thought: true, text: "hidden-reasoning", thoughtSignature: "thought-only-sig" }] } }] },
};
const callStartEvent = {
  response: {
    candidates: [{
      content: {
        parts: [{
          functionCall: { name: "patch_lines", id: "call-1" },
          thoughtSignature: "sig-patch-lines/abc+def=",
          ccaTrace: "keep-this-bytewise",
        }],
      },
    }],
  },
};
const callContinueEvent = {
  response: {
    candidates: [{
      content: {
        parts: [
          { functionCall: { id: "call-1", args: { sceneId: "ch01-lab", note: "문 너머" } } },
          { functionCall: { name: "read_scene", id: "call-2", args: { sceneId: "ch01-lab" } }, thoughtSignature: "sig-read-scene/xyz=" },
        ],
      },
    }],
  },
};
const finishEvent = {
  response: {
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
  },
};
const continuationSse = `${sse(thoughtEvent)}${sse(callStartEvent)}${sse(callContinueEvent)}${sse(finishEvent)}data: [DONE]\n\n`;

function utf8Split(text: string, needle: string): { readonly before: Uint8Array; readonly after: Uint8Array } {
  const full = encoder.encode(text);
  const index = text.indexOf(needle);
  if (index < 0) throw new Error("missing needle");
  const split = encoder.encode(text.slice(0, index)).length + 1;
  return { before: full.subarray(0, split), after: full.subarray(split) };
}

function contentsOf(envelope: unknown): readonly { readonly role?: string; readonly parts?: unknown }[] {
  if (typeof envelope !== "object" || envelope === null) return [];
  const request = Reflect.get(envelope, "request");
  if (typeof request !== "object" || request === null) return [];
  const contents = Reflect.get(request, "contents");
  return Array.isArray(contents) ? contents as readonly { readonly role?: string; readonly parts?: unknown }[] : [];
}

type Held = {
  readonly url: string;
  readonly body: string;
  readonly aborted: Promise<void>;
  write(chunk: string | Uint8Array): void;
  end(): void;
};

function listenHeld(): Promise<{ origin: string; close: () => Promise<void>; next: () => Promise<Held> }> {
  const waiters: ((held: Held) => void)[] = [];
  const queued: Held[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    req.on("end", () => {
      let finished = false;
      const aborted = new Promise<void>((resolve) => {
        req.on("close", () => { if (!res.writableEnded) resolve(); });
      });
      const held: Held = {
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
        aborted,
        write(chunk) {
          if (!res.headersSent) {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          }
          res.write(typeof chunk === "string" ? chunk : Buffer.from(chunk));
        },
        end() {
          finished = true;
          if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.end();
        },
      };
      void finished;
      const waiter = waiters.shift();
      if (waiter) waiter(held);
      else queued.push(held);
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("no-port"));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        next: () => {
          const held = queued.shift();
          if (held) return Promise.resolve(held);
          return new Promise((wait) => { waiters.push(wait); });
        },
        close: () => new Promise((done, fail) => {
          server.closeAllConnections();
          server.close((error) => { if (error) fail(error); else done(); });
        }),
      });
    });
    server.once("error", reject);
  });
}

function countingFetch(state: { count: number }): typeof fetch {
  return async (input, init) => {
    state.count += 1;
    return fetch(input, init);
  };
}

test("fragmented-tool-continuation", async (t) => {
  const split = utf8Split(continuationSse, "문");
  const parser = createIncrementalSseParser();
  const first = parser.push(split.before);
  assert.equal(first.events.length > 0, true);
  assert.equal(first.events.length < 4, true);
  const second = parser.push(split.after);
  assert.equal(first.events.length + second.events.length >= 4, true);
  assert.equal(parser.finish().remainder, "empty");

  const server = await listenHeld();
  t.after(() => server.close());
  const fetches = { count: 0 };
  const wrapped = countingFetch(fetches);
  const dispatched: CompleteFunctionCall[] = [];
  const firstProgress = Promise.withResolvers<void>();
  let settled = false;
  const heldP = server.next();
  const turnP = runProductionTurn({
    envelope: (() => {
      const built = buildProductionRequest({
        projectId: "fixture-project",
        model: PRODUCTION_TEXT_MODEL_ID,
        kind: "text",
        requestId: "turn-1",
        contents: [{ role: "user", parts: [{ text: "draft the lab" }] }],
        tools: [{ functionDeclarations: [{ name: "patch_lines" }, { name: "read_scene" }] }],
      });
      assert.equal(built.kind, "ok");
      if (built.kind !== "ok") throw new Error("envelope");
      return built.envelope;
    })(),
    host: server.origin,
    accessToken: "fixture-access",
    signal: new AbortController().signal,
    fetch: wrapped,
    onFunctionCall: (call) => { dispatched.push(call); },
    onProgress: () => { firstProgress.resolve(); },
  }).then((result) => { settled = true; return result; });
  const held = await heldP;
  held.write(split.before);
  await firstProgress.promise;
  assert.equal(settled, false);
  assert.equal(dispatched.length, 0);
  held.write(split.after);
  held.end();
  const result = await turnP;
  assert.equal(result.kind, "succeeded");
  if (result.kind !== "succeeded") return;
  assert.equal(result.text.includes("hidden-reasoning"), false);
  assert.equal(JSON.stringify(result.replayParts).includes("thought-only-sig"), false);
  assert.equal(JSON.stringify(result.replayParts), JSON.stringify(expectedReplay));
  assert.deepEqual(dispatched.map((call) => call.name), ["patch_lines", "read_scene"]);
  assert.deepEqual(dispatched[0]?.args, callArgs);
  assert.equal(dispatched[0]?.id, "call-1");
  assert.equal(dispatched[0]?.thoughtSignature, "sig-patch-lines/abc+def=");
  const mapped = mapProductionTurnToDispatch(result, { artifactId: "00000000-0000-4000-8000-000000000021", hash: HASH, bytes: 4 });
  assert.equal(mapped.kind, "succeeded");

  const replayed = appendReplayTurn(
    [{ role: "user", parts: [{ text: "draft the lab" }] }],
    result.replayParts,
    [{ name: "patch_lines", response: { ok: true } }, { name: "read_scene", response: { ok: true } }],
  );
  const nextBuilt = buildProductionRequest({
    projectId: "fixture-project",
    model: PRODUCTION_TEXT_MODEL_ID,
    kind: "text",
    requestId: "turn-2",
    contents: replayed,
    tools: [{ functionDeclarations: [{ name: "patch_lines" }, { name: "read_scene" }] }],
  });
  assert.equal(nextBuilt.kind, "ok");
  if (nextBuilt.kind !== "ok") return;
  assert.equal(nextBuilt.includes.opaque, true);
  assert.equal(nextBuilt.includes.images, false);
  const nextHeldP = server.next();
  const nextTurn = runProductionTurn({
    envelope: nextBuilt.envelope,
    host: server.origin,
    accessToken: "fixture-access",
    signal: new AbortController().signal,
    fetch: wrapped,
    onFunctionCall: () => { throw new Error("second-turn-should-wait"); },
  });
  const nextHeld = await nextHeldP;
  const captured = JSON.parse(nextHeld.body) as unknown;
  const model = contentsOf(captured).find((row) => row.role === "model");
  assert.equal(JSON.stringify(model?.parts), JSON.stringify(expectedReplay));
  nextHeld.write(sse({ response: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } } }));
  nextHeld.end();
  const nextResult = await nextTurn;
  assert.equal(nextResult.kind, "succeeded");
  assert.equal(fetches.count, 2);
});

test("truncated-call-never-dispatches", async (t) => {
  const server = await listenHeld();
  t.after(() => server.close());
  const fetches = { count: 0 };
  const wrapped = countingFetch(fetches);
  const built = buildProductionRequest({
    projectId: "fixture-project",
    model: PRODUCTION_TEXT_MODEL_ID,
    kind: "text",
    requestId: "trunc-1",
    contents: [{ role: "user", parts: [{ text: "patch" }] }],
  });
  assert.equal(built.kind, "ok");
  if (built.kind !== "ok") return;

  async function runWith(write: (held: Held) => void): Promise<{ result: ProductionTurnResult; dispatched: number }> {
    const dispatched: CompleteFunctionCall[] = [];
    const heldP = server.next();
    const turn = runProductionTurn({
      envelope: built.kind === "ok" ? built.envelope : {},
      host: server.origin,
      accessToken: "fixture-access",
      signal: new AbortController().signal,
      fetch: wrapped,
      onFunctionCall: (call) => { dispatched.push(call); },
    });
    const held = await heldP;
    write(held);
    const result = await turn;
    return { result, dispatched: dispatched.length };
  }

  const truncatedJson = await runWith((held) => {
    held.write(`data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"patch_lines","args":{"sceneId":"ch01`);
    held.end();
  });
  assert.equal(truncatedJson.dispatched, 0);
  assert.equal(truncatedJson.result.kind, "incomplete");
  if (truncatedJson.result.kind === "incomplete") assert.equal(truncatedJson.result.dispatchCount, 0);

  const noFinish = await runWith((held) => {
    held.write(sse({
      response: { candidates: [{ content: { parts: [{ functionCall: { name: "patch_lines", args: { sceneId: "ch01-lab" } } }] } }] },
    }));
    held.end();
  });
  assert.equal(noFinish.dispatched, 0);
  assert.equal(noFinish.result.kind, "incomplete");

  const malformed = await runWith((held) => {
    held.write(sse({
      response: {
        candidates: [{
          content: { parts: [{ functionCall: { name: "patch_lines", args: "{not json" } }] },
          finishReason: "STOP",
        }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      },
    }));
    held.end();
  });
  assert.equal(malformed.dispatched, 0);
  assert.equal(malformed.result.kind, "unknown");
  if (malformed.result.kind === "unknown") assert.equal(malformed.result.dispatchCount, 0);

  const beforeWrong = fetches.count;
  const wrongModel = buildProductionRequest({
    projectId: "fixture-project",
    model: "gemini-3.8-flash",
    kind: "text",
    requestId: "trunc-model",
    contents: [{ role: "user", parts: [{ text: "x" }] }],
  });
  assert.equal(wrongModel.kind, "capability");
  if (wrongModel.kind === "capability") assert.equal(wrongModel.reason, "MODEL_MISMATCH");
  const wrongSignature = await runProductionTurn({
    envelope: {
      project: "fixture-project",
      model: PRODUCTION_TEXT_MODEL_ID,
      request: { contents: [{ role: "user", parts: [{ text: "x" }] }], generationConfig: {} },
      requestType: "chat",
      requestId: "trunc-sig",
      userAgent: "antigravity",
    },
    host: server.origin,
    accessToken: "fixture-access",
    signal: new AbortController().signal,
    fetch: wrapped,
    onFunctionCall: () => { throw new Error("signature-must-not-dispatch"); },
  });
  assert.equal(wrongSignature.kind, "capability");
  if (wrongSignature.kind === "capability") assert.equal(wrongSignature.reason, "REQUEST_SIGNATURE");
  assert.equal(fetches.count, beforeWrong);
});

test("single-flight-oauth-refresh", async () => {
  const clock = { now: () => 10_000 };
  const store = createMemoryStore({
    refresh: "fixture-refresh", access: "stale", expires: 1, projectId: "fixture-project", email: "u@example.invalid",
  });
  let refreshes = 0;
  const gate = Promise.withResolvers<void>();
  const access = createSingleFlightAccess({
    store,
    clock,
    refresh: async () => {
      refreshes += 1;
      await gate.promise;
      return { access_token: "fresh-access", expires_in: 3600 };
    },
  });
  const first = access.ensureFreshAccess();
  const second = access.ensureFreshAccess();
  gate.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(refreshes, 1);
  assert.equal(results[0]?.refreshed, true);
  assert.equal(results[1]?.refreshed, true);
  assert.equal(results[0]?.credentials.access, "fresh-access");
  assert.equal((await store.read())?.access, "fresh-access");
});

test("cancel-propagates-upstream", async (t) => {
  const server = await listenHeld();
  t.after(() => server.close());
  const built = buildProductionRequest({
    projectId: "fixture-project",
    model: PRODUCTION_TEXT_MODEL_ID,
    kind: "text",
    requestId: "cancel-1",
    contents: [{ role: "user", parts: [{ text: "x" }] }],
  });
  assert.equal(built.kind, "ok");
  if (built.kind !== "ok") return;
  const controller = new AbortController();
  const dispatched: CompleteFunctionCall[] = [];
  const heldP = server.next();
  const turn = runProductionTurn({
    envelope: built.envelope,
    host: server.origin,
    accessToken: "fixture-access",
    signal: controller.signal,
    onFunctionCall: (call) => { dispatched.push(call); },
  });
  const held = await heldP;
  held.write(sse(callStartEvent));
  controller.abort();
  await held.aborted;
  const result = await turn;
  assert.equal(result.kind, "cancelled");
  assert.equal(dispatched.length, 0);
});

test("provider-context-exceeded-and-missing-usage", async (t) => {
  const server = await listenHeld();
  t.after(() => server.close());
  const built = buildProductionRequest({
    projectId: "fixture-project",
    model: PRODUCTION_TEXT_MODEL_ID,
    kind: "text",
    requestId: "states-1",
    contents: [{ role: "user", parts: [{ text: "x" }] }],
  });
  assert.equal(built.kind, "ok");
  if (built.kind !== "ok") return;
  const dispatched: CompleteFunctionCall[] = [];
  const contextHeldP = server.next();
  const contextTurn = runProductionTurn({
    envelope: built.envelope,
    host: server.origin,
    accessToken: "fixture-access",
    signal: new AbortController().signal,
    onFunctionCall: (call) => { dispatched.push(call); },
  });
  const contextHeld = await contextHeldP;
  contextHeld.write(sse({ error: { status: "INVALID_ARGUMENT", message: "input token count exceeds the context window" } }));
  contextHeld.end();
  const contextResult = await contextTurn;
  assert.equal(contextResult.kind, "provider-context-exceeded");
  assert.equal(dispatched.length, 0);

  const usageHeldP = server.next();
  const usageTurn = runProductionTurn({
    envelope: built.envelope,
    host: server.origin,
    accessToken: "fixture-access",
    signal: new AbortController().signal,
    onFunctionCall: (call) => { dispatched.push(call); },
  });
  const usageHeld = await usageHeldP;
  usageHeld.write(sse({
    response: {
      candidates: [{ content: { parts: [{ text: "line" }] }, finishReason: "STOP" }],
    },
  }));
  usageHeld.end();
  const usageResult = await usageTurn;
  assert.equal(usageResult.kind, "missing-usage");
  assert.notEqual(usageResult.kind, "provider-context-exceeded");
  assert.equal(dispatched.length, 0);
});
