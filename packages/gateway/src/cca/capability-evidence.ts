import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UpstreamError } from "../http.js";
import {
  assertNever, collectOpaqueReplayParts, sha256Canonical, storedProbeProof,
} from "./capabilities.js";
import type { CapabilityProof } from "./capabilities.js";
import { collectImages, parseSseChunks } from "./images.js";
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
