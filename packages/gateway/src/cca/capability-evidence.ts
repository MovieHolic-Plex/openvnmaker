import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UpstreamError } from "../http.js";
import {
  PRODUCTION_IMAGE_MODEL_ID, assertNever, collectOpaqueReplayParts, sha256Canonical, storedProbeProof,
} from "./capabilities.js";
import type { CapabilityProof } from "./capabilities.js";
import { buildImageRequest, collectImages, generateTinyPng, parseSseChunks } from "./images.js";
import { readArray, readObject } from "./production-util.js";

export type ProbeEffectState = "intent" | "dispatched" | "succeeded" | "known-failed" | "unknown";
export type ProbeEffect = { readonly payloadHash: string; readonly state: ProbeEffectState };

export function observeSsePayload(payload: string): {
  readonly text: boolean; readonly tools: boolean; readonly imageOutput: boolean;
} {
  const chunks = parseSseChunks(payload);
  let text = false;
  let tools = false;
  for (const part of collectOpaqueReplayParts(chunks)) {
    const rec = readObject(part);
    if (rec === undefined) continue;
    const body = rec["text"];
    if (typeof body === "string" && body.length > 0) text = true;
    const name = readObject(rec["functionCall"])?.["name"];
    if (typeof name === "string" && name.length > 0) tools = true;
  }
  return { text, tools, imageOutput: collectImages(chunks).images.some((image) => image.data.length > 0) };
}

export function observeExactUsage(payload: string): boolean {
  for (const chunk of parseSseChunks(payload)) {
    const usage = readObject(readObject(chunk)?.["response"])?.["usageMetadata"];
    const rec = readObject(usage);
    if (rec === undefined) continue;
    const input = rec["promptTokenCount"] ?? rec["inputTokenCount"];
    const output = rec["candidatesTokenCount"] ?? rec["outputTokenCount"];
    if (typeof input === "number" && typeof output === "number" && Number.isFinite(input) && Number.isFinite(output)) {
      return true;
    }
  }
  return false;
}

export function requestCarriesReferenceInput(body: unknown): boolean {
  const request = readObject(readObject(body)?.["request"]);
  for (const content of readArray(request?.["contents"])) {
    for (const part of readArray(readObject(content)?.["parts"])) {
      const data = readObject(readObject(part)?.["inlineData"])?.["data"];
      if (typeof data === "string" && data.length > 0) return true;
    }
  }
  return false;
}

export function observeReferenceEvidence(request: unknown, response: string): boolean {
  return requestCarriesReferenceInput(request) && observeSsePayload(response).imageOutput;
}

export function probeReferenceImageRequest(projectId: string): {
  readonly body: Record<string, unknown>; readonly rawBytes: number;
} {
  const bytes = generateTinyPng();
  const data = Buffer.from(bytes).toString("base64");
  return {
    rawBytes: bytes.byteLength,
    body: buildImageRequest({
      prompt: "Recolor this reference cup slightly, keeping the same object.",
      projectId, model: PRODUCTION_IMAGE_MODEL_ID, requestId: "probe-image-ref-1",
      references: [{ mimeType: "image/png", data }],
    }),
  };
}

export async function loadProbeEffects(directory: string): Promise<readonly ProbeEffect[]> {
  let raw: unknown = [];
  try { raw = JSON.parse(await readFile(join(directory, "effects.json"), "utf8")); } catch { raw = []; }
  if (!Array.isArray(raw)) throw new Error("INVALID_INPUT");
  return raw.map((value) => {
    if (typeof value !== "object" || value === null) throw new Error("INVALID_INPUT");
    const payloadHash = Reflect.get(value, "payloadHash");
    const state = Reflect.get(value, "state");
    if (typeof payloadHash !== "string") throw new Error("INVALID_INPUT");
    switch (state) {
      case "intent": case "dispatched": case "succeeded": case "known-failed": case "unknown":
        return { payloadHash, state };
      default: throw new Error("INVALID_INPUT");
    }
  });
}

export function opaquePartsMatch(sentParts: readonly unknown[], collectedParts: readonly unknown[]): boolean {
  return collectedParts.length > 0 && sha256Canonical(sentParts) === sha256Canonical(collectedParts);
}

export function requestModelParts(body: Record<string, unknown>): readonly unknown[] {
  const request = readObject(body["request"]);
  for (const entry of readArray(request?.["contents"])) {
    const rec = readObject(entry);
    if (rec?.["role"] === "model") return readArray(rec["parts"]);
  }
  return [];
}

export function buildObservedProof(input: {
  readonly modelId: string; readonly contextHash: string; readonly observedAt: string;
  readonly requestBodies: readonly unknown[]; readonly responsePayloads: readonly string[];
  readonly text: boolean; readonly tools: boolean; readonly opaqueRoundtrip: boolean;
  readonly imageOutput: boolean; readonly imageReference: boolean;
}): CapabilityProof {
  const requestHashes = input.requestBodies.map((body) => sha256Canonical(body));
  const responseHashes = input.responsePayloads.map((payload) => sha256Canonical(payload));
  const recorded = {
    modelId: input.modelId, contextHash: input.contextHash, observedAt: input.observedAt,
    requestHashes, responseHashes, text: input.text, tools: input.tools,
    opaqueRoundtrip: input.opaqueRoundtrip, imageOutput: input.imageOutput, imageReference: input.imageReference,
  };
  return storedProbeProof({ ...recorded, evidenceHash: sha256Canonical(recorded) });
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

export async function commitProbeEffect(
  directory: string, effects: readonly ProbeEffect[], payloadHash: string, state: ProbeEffectState,
): Promise<readonly ProbeEffect[]> {
  const next: readonly ProbeEffect[] = [...effects.filter((item) => item.payloadHash !== payloadHash), { payloadHash, state }];
  await writeFile(join(directory, "effects.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function dispatchProbePayload(
  directory: string, effects: readonly ProbeEffect[], payload: unknown, send: () => Promise<string>,
): Promise<{ readonly response: string; readonly effects: readonly ProbeEffect[] }> {
  const payloadHash = sha256Canonical(payload);
  assertUnknownRequestNotResent(effects, payloadHash);
  const dispatched = await commitProbeEffect(directory, effects, payloadHash, "dispatched");
  try {
    const response = await send();
    return { response, effects: await commitProbeEffect(directory, dispatched, payloadHash, "succeeded") };
  } catch (error) {
    await commitProbeEffect(directory, dispatched, payloadHash, error instanceof UpstreamError ? "known-failed" : "unknown");
    throw error;
  }
}
