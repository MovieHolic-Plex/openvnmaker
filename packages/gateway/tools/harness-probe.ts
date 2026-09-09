import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createFileStore } from "../src/auth/credentials.js";
import { ensureFreshAccess } from "../src/auth/tokens.js";
import {
  AGENT_MAX_OUTPUT_TOKENS, CCA_HOSTS, CLIENT_ID, GENERATE_MAX_OUTPUT_TOKENS, GENERATE_PROMPT_MAX,
  GENERATE_TIMEOUT_MS, IMAGE_TIMEOUT_MS, LOAD_CODE_ASSIST_METADATA, PROVIDER, SCOPES,
  TEXT_THINKING_CONFIG, TOKEN_URL, antigravityUserAgent, ccaHeaders,
} from "../src/config.js";
import { fetchAvailableModels } from "../src/cca/client.js";
import {
  OPAQUE_METADATA_PROBE_CONTRACT, PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID, assertNever,
  capabilityContextHash, collectOpaqueReplayParts, evaluateCapabilities, inspectStoredAuth, sha256Canonical,
} from "../src/cca/capabilities.js";
import type { AuthState, CapabilityUpstream } from "../src/cca/capabilities.js";
import { buildImageRequest, parseSseChunks } from "../src/cca/images.js";
import { UpstreamError } from "../src/http.js";

const TEXT_CONTEXT_LIMIT = 65_536;
const WIRE_BODY_LIMIT = 20 * 1024 * 1024;
const IMAGE_INPUT_LIMIT = 4;
const SINGLE_IMAGE_BYTES = 8 * 1024 * 1024;
const ALL_IMAGE_BYTES = 12 * 1024 * 1024;
export type TokenPolicy = "exact-only" | "bounded-payload";
export type TokenCheck = "pass" | "fail" | "unknown";
export type ProbeCliArgs = {
  readonly authorizeText: number; readonly authorizeImages: number; readonly tokenPolicy: TokenPolicy; readonly out: string;
};
export type ProbeEffectState = "intent" | "dispatched" | "succeeded" | "known-failed" | "unknown";
export type ProbeEffect = { readonly payloadHash: string; readonly state: ProbeEffectState };

export function parseProbeCli(args: readonly string[]): ProbeCliArgs {
  const { values } = parseArgs({ args: [...args], allowPositionals: false, strict: true, options: {
    "authorize-text": { type: "string" }, "authorize-images": { type: "string" },
    "token-policy": { type: "string" }, out: { type: "string" },
  } });
  const authorizeText = Number(values["authorize-text"]);
  const authorizeImages = Number(values["authorize-images"]);
  const tokenPolicy = values["token-policy"];
  if (!Number.isInteger(authorizeText) || authorizeText < 0 || !Number.isInteger(authorizeImages) || authorizeImages < 0) {
    throw new Error("PROBE_PERMISSION_REQUIRED");
  }
  if (tokenPolicy !== "exact-only" && tokenPolicy !== "bounded-payload") throw new Error("PROBE_PERMISSION_REQUIRED");
  if (values.out === undefined || values.out.trim() === "") throw new Error("PROBE_PERMISSION_REQUIRED");
  return { authorizeText, authorizeImages, tokenPolicy, out: resolve(values.out) };
}

export function admitProbeGuards(input: {
  readonly textContextBytes: number; readonly wireBodyBytes: number; readonly images: readonly { readonly rawBytes: number }[];
  readonly authorizeText: number; readonly authorizeImages: number; readonly reservedText: number; readonly reservedImages: number;
  readonly tokenCheck: TokenCheck; readonly policy: TokenPolicy;
}): { readonly allowed: boolean; readonly tokenCheck: TokenCheck; readonly reason: string | null; readonly authorization: "bounded-payload-approved" | null } {
  let reason: string | null = null;
  let imageBytes = 0;
  if (input.textContextBytes > TEXT_CONTEXT_LIMIT) reason ??= "TEXT_BYTES_LIMIT";
  if (input.wireBodyBytes > WIRE_BODY_LIMIT) reason ??= "WIRE_BYTES_LIMIT";
  if (input.images.length > IMAGE_INPUT_LIMIT) reason ??= "IMAGE_INPUTS_LIMIT";
  for (const image of input.images) {
    if (image.rawBytes > SINGLE_IMAGE_BYTES) reason ??= "SINGLE_IMAGE_BYTES_LIMIT";
    imageBytes += image.rawBytes;
  }
  if (imageBytes > ALL_IMAGE_BYTES) reason ??= "ALL_IMAGE_BYTES_LIMIT";
  if (input.reservedText > input.authorizeText) reason ??= "TEXT_ATTEMPTS_LIMIT";
  if (input.reservedImages > input.authorizeImages) reason ??= "IMAGE_ATTEMPTS_LIMIT";
  const tokenCheck: TokenCheck = input.tokenCheck === "pass" ? "unknown" : input.tokenCheck;
  if (tokenCheck === "fail") reason ??= "CONTEXT_LIMIT";
  if (tokenCheck === "unknown") {
    switch (input.policy) {
      case "exact-only": reason ??= "CAPABILITY_REQUIRED"; break;
      case "bounded-payload": break;
      default: return assertNever(input.policy);
    }
  }
  const allowed = reason === null;
  return { allowed, tokenCheck, reason, authorization: allowed && tokenCheck === "unknown" && input.policy === "bounded-payload" ? "bounded-payload-approved" : null };
}

export function assertUnknownRequestNotResent(effects: readonly ProbeEffect[], payloadHash: string): void {
  for (const effect of effects) {
    if (effect.payloadHash !== payloadHash) continue;
    switch (effect.state) {
      case "unknown": case "dispatched": throw new Error("UNKNOWN_EFFECT");
      case "intent": case "succeeded": case "known-failed": break;
      default: return assertNever(effect.state);
    }
  }
}

async function loadEffects(directory: string): Promise<readonly ProbeEffect[]> {
  let raw: unknown = [];
  try { raw = JSON.parse(await readFile(join(directory, "effects.json"), "utf8")); } catch { raw = []; }
  if (!Array.isArray(raw)) throw new Error("INVALID_INPUT");
  return raw.map((value) => {
    if (typeof value !== "object" || value === null) throw new Error("INVALID_INPUT");
    const payloadHash = Reflect.get(value, "payloadHash");
    const state = Reflect.get(value, "state");
    if (typeof payloadHash !== "string") throw new Error("INVALID_INPUT");
    switch (state) {
      case "intent": case "dispatched": case "succeeded": case "known-failed": case "unknown": return { payloadHash, state };
      default: throw new Error("INVALID_INPUT");
    }
  });
}

const forbiddenUpstream: CapabilityUpstream = { generate: async () => { throw new Error("evaluateCapabilities must not generate"); } };

function echoRequest(projectId: string, requestId: string, modelParts: readonly unknown[] = []): Record<string, unknown> {
  const user = { role: "user", parts: [{ text: "Call echo with value vnmaker-capability-probe, then return its result." }] };
  const contents = modelParts.length === 0 ? [user] : [user, { role: "model", parts: modelParts },
    { role: "user", parts: [{ functionResponse: { name: "echo", response: { value: "vnmaker-capability-probe" } } }] }];
  return {
    project: projectId, model: PRODUCTION_TEXT_MODEL_ID, requestType: "agent", requestId, userAgent: "antigravity",
    request: {
      contents, generationConfig: { maxOutputTokens: 1024, temperature: 0, candidateCount: 1, thinkingConfig: TEXT_THINKING_CONFIG },
      tools: [{ functionDeclarations: [{ name: "echo", description: "Return the supplied value unchanged.",
        parameters: { type: "OBJECT", properties: { value: { type: "STRING" } }, required: ["value"] } }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["echo"] } },
    },
  };
}

async function postSse(accessToken: string, body: unknown, timeoutMs: number): Promise<string> {
  let lastError: unknown;
  for (const host of CCA_HOSTS) {
    try {
      const res = await fetch(`${host}/v1internal:streamGenerateContent?alt=sse`, {
        method: "POST", headers: { ...ccaHeaders(accessToken), Accept: "text/event-stream" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) throw new UpstreamError(`probe failed: ${res.status}`, res.status, text.slice(0, 1200));
      return text;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("probe failed");
}

function writeReceipt(directory: string, body: unknown): Promise<void> {
  return writeFile(join(directory, "receipt.json"), `${JSON.stringify(body, null, 2)}\n`);
}

export async function runAuthorizedProbe(args: ProbeCliArgs): Promise<void> {
  await mkdir(args.out, { recursive: true });
  const effects = await loadEffects(args.out);
  const store = createFileStore();
  let credentials = await store.read();
  let auth: AuthState = inspectStoredAuth(credentials, Date.now());
  if (auth.kind !== "present") {
    const fresh = await ensureFreshAccess(store);
    credentials = fresh === null || fresh === undefined ? null : fresh.credentials;
    auth = inspectStoredAuth(credentials, Date.now());
  }
  if (credentials === null || auth.kind !== "present") {
    await writeReceipt(args.out, { status: "blocked", block: { kind: "auth", code: auth.kind === "expired" ? "AUTH_EXPIRED" : "AUTH_REQUIRED" },
      tokenCheck: "unknown", liveVerification: "not-performed", opaque: OPAQUE_METADATA_PROBE_CONTRACT });
    return;
  }
  const context = {
    accountScope: auth.accountScope, providerProjectId: auth.providerProjectId,
    configDigest: sha256Canonical({
      provider: PROVIDER, hosts: CCA_HOSTS, clientId: CLIENT_ID, tokenUrl: TOKEN_URL, scopes: SCOPES,
      metadata: LOAD_CODE_ASSIST_METADATA, userAgent: antigravityUserAgent(),
      textModelId: PRODUCTION_TEXT_MODEL_ID, imageModelId: PRODUCTION_IMAGE_MODEL_ID, thinking: TEXT_THINKING_CONFIG,
      textTimeout: GENERATE_TIMEOUT_MS, imageTimeout: IMAGE_TIMEOUT_MS, capabilityProtocol: 1,
      textOutput: GENERATE_MAX_OUTPUT_TOKENS, agentOutput: AGENT_MAX_OUTPUT_TOKENS, promptMax: GENERATE_PROMPT_MAX,
    }),
    textModelId: PRODUCTION_TEXT_MODEL_ID, imageModelId: PRODUCTION_IMAGE_MODEL_ID,
  };
  const catalogue = await fetchAvailableModels(credentials.access);
  const report = evaluateCapabilities({ auth, context, models: catalogue.models, proofs: [], upstream: forbiddenUpstream });
  const echo = echoRequest(credentials.projectId, "probe-echo-1");
  const wireBodyBytes = Buffer.byteLength(JSON.stringify(echo), "utf8");
  assertUnknownRequestNotResent(effects, sha256Canonical(echo));
  const admission = admitProbeGuards({
    textContextBytes: wireBodyBytes, wireBodyBytes, images: [], authorizeText: args.authorizeText,
    authorizeImages: args.authorizeImages, reservedText: 1, reservedImages: 0, tokenCheck: "unknown", policy: args.tokenPolicy,
  });
  if (admission.tokenCheck === "pass") throw new Error("tokenCheck unknown must not be reported as PASS");
  if (!report.text.present || !report.image.present || !admission.allowed) {
    await writeReceipt(args.out, { status: "blocked", report, admission, tokenCheck: admission.tokenCheck,
      liveVerification: "not-performed", contextHash: capabilityContextHash(context), opaque: OPAQUE_METADATA_PROBE_CONTRACT });
    return;
  }
  const replayParts = collectOpaqueReplayParts(parseSseChunks(await postSse(credentials.access, echo, GENERATE_TIMEOUT_MS)));
  const second = echoRequest(credentials.projectId, "probe-echo-2", replayParts);
  assertUnknownRequestNotResent(effects, sha256Canonical(second));
  await postSse(credentials.access, second, GENERATE_TIMEOUT_MS);
  if (args.authorizeImages > 0) {
    const imageBody = buildImageRequest({ prompt: "A simple blue ceramic cup on a plain white background.",
      projectId: credentials.projectId, model: PRODUCTION_IMAGE_MODEL_ID });
    assertUnknownRequestNotResent(effects, sha256Canonical(imageBody));
    const imageAdmit = admitProbeGuards({
      textContextBytes: wireBodyBytes, wireBodyBytes: Buffer.byteLength(JSON.stringify(imageBody), "utf8"),
      images: [], authorizeText: args.authorizeText, authorizeImages: args.authorizeImages,
      reservedText: 0, reservedImages: 1, tokenCheck: "unknown", policy: args.tokenPolicy,
    });
    if (imageAdmit.tokenCheck === "pass") throw new Error("tokenCheck unknown must not be reported as PASS");
    if (imageAdmit.allowed) await postSse(credentials.access, imageBody, IMAGE_TIMEOUT_MS);
  }
  await writeReceipt(args.out, { status: "completed", tokenCheck: admission.tokenCheck, authorization: admission.authorization,
    liveVerification: "performed", opaque: OPAQUE_METADATA_PROBE_CONTRACT, report });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runAuthorizedProbe(parseProbeCli(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
