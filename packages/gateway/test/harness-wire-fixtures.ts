import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMemoryStore } from "../src/auth/credentials.js";
import type { Credentials } from "../src/auth/credentials.js";
import {
  PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID, capabilityContextHash, storedProbeProof,
} from "../src/cca/capabilities.js";
import type { CapabilityContext, CapabilityProof } from "../src/cca/capabilities.js";
import { mapModels } from "../src/cca/client.js";
import { DEFAULT_BUDGET_LIMITS, hashSchema, unitIdSchema, uuidSchema } from "../../harness/src/index.js";
import type { BudgetAdmission, ProviderDispatchRequest } from "../../harness/src/index.js";
import { HASH, IDS } from "./harness-runner-fixtures.js";

export const WIRE_DIGEST = "a".repeat(64);
export const WIRE_CONTEXT: CapabilityContext = {
  accountScope: "account-a",
  providerProjectId: "project-a",
  configDigest: WIRE_DIGEST,
  textModelId: PRODUCTION_TEXT_MODEL_ID,
  imageModelId: PRODUCTION_IMAGE_MODEL_ID,
};
export const expectedReplay = [
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

export function wireCredentials(expires = Date.now() + 600_000): Credentials {
  return {
    refresh: "fixture-refresh", access: "fixture-access", expires,
    projectId: "project-a", email: "account-a",
  };
}

export function wireModels() {
  return mapModels({
    [PRODUCTION_TEXT_MODEL_ID]: { supportsImages: true },
    [PRODUCTION_IMAGE_MODEL_ID]: { supportsImages: true },
  });
}

function proof(
  modelId: string,
  flags: Pick<CapabilityProof, "text" | "tools" | "opaqueRoundtrip" | "imageOutput" | "imageReference">,
): CapabilityProof {
  return storedProbeProof({
    modelId,
    contextHash: capabilityContextHash(WIRE_CONTEXT),
    evidenceHash: modelId === PRODUCTION_TEXT_MODEL_ID ? "b".repeat(64) : "c".repeat(64),
    observedAt: "2026-09-09T00:00:00.000Z",
    requestHashes: ["d".repeat(64), "e".repeat(64)],
    responseHashes: ["f".repeat(64), "0".repeat(64)],
    ...flags,
  });
}

export function textProof(): CapabilityProof {
  return proof(PRODUCTION_TEXT_MODEL_ID, {
    text: true, tools: true, opaqueRoundtrip: true, imageOutput: false, imageReference: false,
  });
}

export function imageProof(): CapabilityProof {
  return proof(PRODUCTION_IMAGE_MODEL_ID, {
    text: false, tools: false, opaqueRoundtrip: false, imageOutput: true, imageReference: true,
  });
}

export function forbiddenFetch(): typeof fetch {
  return async () => {
    throw new Error("live-provider-forbidden");
  };
}

export function countingFetch(state: { count: number }): typeof fetch {
  return async (input, init) => {
    state.count += 1;
    return fetch(input, init);
  };
}

export function boundedAdmission(): BudgetAdmission {
  return {
    requestPayloadHash: hashSchema.parse(HASH.a),
    capabilityBindingHash: hashSchema.parse(HASH.b),
    budgetGroupId: uuidSchema.parse(IDS.group),
    limitVersion: 0,
    textContextBytes: 1024,
    wireBodyBytes: 1024,
    images: [],
    countedInputTokens: null,
    tokenWindowMode: "unknown",
    requestedOutputTokens: 8192,
    tokenCheck: "unknown",
    policy: "bounded-payload",
    allowed: true,
    reason: null,
    authorization: "bounded-payload-approved",
  };
}

export function wireRequest(
  kind: ProviderDispatchRequest["kind"],
  unitId = IDS.u1,
): ProviderDispatchRequest {
  return {
    effectId: uuidSchema.parse(unitId),
    unitId: unitIdSchema.parse(unitId),
    runId: IDS.run,
    payloadHash: hashSchema.parse(HASH.a),
    admission: boundedAdmission(),
    kind,
    signal: new AbortController().signal,
  };
}

export function tinyWireLimits() {
  return {
    ...DEFAULT_BUDGET_LIMITS,
    request: { ...DEFAULT_BUDGET_LIMITS.request, wireBodyBytes: 64 },
  };
}

export function credentialStore(credentials: Credentials | null = wireCredentials()) {
  return createMemoryStore(credentials);
}

export type WireScript = "success" | "quota" | "disconnect" | "opaque";

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function writeEvents(res: ServerResponse, events: readonly unknown[]): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) res.write(sse(event));
  res.write("data: [DONE]\n\n");
  res.end();
}

function writeScript(res: ServerResponse, script: WireScript): void {
  switch (script) {
    case "quota":
      res.writeHead(429).end();
      return;
    case "disconnect":
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: {\"response\":{}}\n\n");
      res.destroy();
      return;
    case "success":
      writeEvents(res, [{ response: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 } } }]);
      return;
    case "opaque":
      writeEvents(res, [
        { response: { candidates: [{ content: { parts: [{ thought: true, text: "hidden-reasoning" }] } }] } },
        { response: { candidates: [{ content: { parts: [{ functionCall: { name: "patch_lines", id: "call-1" }, thoughtSignature: "sig-patch-lines/abc+def=", ccaTrace: "keep-this-bytewise" }] } }] } },
        { response: { candidates: [{ content: { parts: [{ functionCall: { id: "call-1", args: { sceneId: "ch01-lab", note: "문 너머" } } }, { functionCall: { name: "read_scene", id: "call-2", args: { sceneId: "ch01-lab" } }, thoughtSignature: "sig-read-scene/xyz=" }] } }] } },
        { response: { candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 } } },
      ]);
      return;
    default: {
      const never: never = script;
      throw new Error(`unexpected-script:${String(never)}`);
    }
  }
}

export async function listenWireHttp(script: () => WireScript): Promise<{
  readonly origin: string;
  readonly close: () => Promise<void>;
  readonly requests: () => number;
  readonly bodies: () => readonly string[];
  readonly models: () => readonly (string | undefined)[];
}> {
  let requests = 0;
  const bodies: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    req.on("end", () => {
      requests += 1;
      const body = Buffer.concat(chunks).toString("utf8");
      bodies.push(body);
      writeScript(res, script());
    });
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
    bodies: () => bodies,
    models: () => bodies.map(readEnvelopeModel),
    close: () => new Promise((done, fail) => {
      server.closeAllConnections();
      server.close((error) => { if (error) fail(error); else done(); });
    }),
  };
}

export function readEnvelopeModel(body: string): string | undefined {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const model = Reflect.get(parsed, "model");
  return typeof model === "string" ? model : undefined;
}

export function readModelParts(body: string): unknown {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const request = Reflect.get(parsed, "request");
  if (typeof request !== "object" || request === null) return undefined;
  const contents = Reflect.get(request, "contents");
  if (!Array.isArray(contents)) return undefined;
  for (const row of contents) {
    if (typeof row !== "object" || row === null) continue;
    if (Reflect.get(row, "role") === "model") return Reflect.get(row, "parts");
  }
  return undefined;
}
