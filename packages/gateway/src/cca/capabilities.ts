import { createHash } from "node:crypto";
import type { Credentials } from "../auth/credentials.js";
import { observedExactUsage, tokenBindingFields } from "./capability-binding.js";
import type { CounterObservation } from "./capability-binding.js";
import type { ModelEntry } from "./client.js";

export const PRODUCTION_TEXT_MODEL_ID = "gemini-3.8-flash-high";
export const PRODUCTION_IMAGE_MODEL_ID = "gemini-3.1-flash-image";
export const OPAQUE_METADATA_PROBE_CONTRACT = {
  kind: "opaque-metadata-preservation", preserveModelContentParts: true, preserveFunctionCallIds: true,
  preserveOpaqueSignatures: true, replayByteEquivalent: true, exposeThought: false,
  unknownTokenCheckIsNotPass: true, unknownEffectDoesNotAutoreplay: true,
} as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const OBSERVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type AuthState =
  | { readonly kind: "missing" }
  | { readonly kind: "expired"; readonly accountScope?: string; readonly providerProjectId: string }
  | { readonly kind: "present"; readonly accountScope: string; readonly providerProjectId: string };
export type CapabilityBlock =
  | { readonly kind: "auth"; readonly code: "AUTH_REQUIRED" | "AUTH_EXPIRED" }
  | { readonly kind: "quota"; readonly code: "QUOTA"; readonly remainingFraction: 0 }
  | { readonly kind: "capability"; readonly code: "MODEL_MISSING" | "VISION_ONLY" | "CONFIG_MODEL_MISMATCH" | "PROBE_STALE" | "PROBE_FAILED" };
export type FeatureReadiness =
  | { readonly status: "ready"; readonly evidenceHash: string }
  | { readonly status: "unverified"; readonly reason: "live-probe-required" }
  | { readonly status: "blocked"; readonly block: CapabilityBlock };
export type CapabilityContext = {
  readonly accountScope: string; readonly providerProjectId: string; readonly configDigest: string;
  readonly textModelId: string; readonly imageModelId: string;
};
export type CapabilityProof = {
  readonly modelId: string; readonly contextHash: string; readonly evidenceHash: string; readonly observedAt: string;
  readonly requestHashes: readonly string[]; readonly responseHashes: readonly string[];
  readonly text: boolean; readonly tools: boolean; readonly opaqueRoundtrip: boolean;
  readonly imageOutput: boolean; readonly imageReference: boolean;
};
export type CapabilityUpstream = {
  readonly generate: (kind: "text" | "image" | "tool", modelId: string) => Promise<unknown>;
};
export type ModelReadiness = {
  readonly modelId: string; readonly present: boolean; readonly inputVision: boolean;
  readonly remainingFraction: number | null; readonly resetTime: string | null;
  readonly text: FeatureReadiness; readonly tools: FeatureReadiness;
  readonly imageOutput: FeatureReadiness; readonly imageReference: FeatureReadiness;
  readonly binding: {
    readonly accountScope: string; readonly providerProjectId: string; readonly modelId: string;
    readonly configDigest: string; readonly evidenceHash: string; readonly counterSupport: "exact" | "unsupported";
    readonly tokenWindowMode: "input-only" | "combined" | "unknown"; readonly inputTokenLimit: number | null;
    readonly outputTokenLimit: number | null; readonly combinedTokenLimit: number | null; readonly ready: boolean;
  };
};
export type CapabilityReport = {
  readonly context: CapabilityContext; readonly contextHash: string; readonly text: ModelReadiness;
  readonly image: ModelReadiness; readonly productionReady: boolean; readonly liveVerification: "not-performed" | "performed";
};
export type { CounterObservation } from "./capability-binding.js";
export type CapabilityInput = {
  readonly auth: AuthState; readonly context: CapabilityContext; readonly models: readonly ModelEntry[];
  readonly proofs: readonly CapabilityProof[]; readonly counters?: readonly CounterObservation[];
  readonly upstream: CapabilityUpstream;
};

export function assertNever(value: never): never {
  throw new Error(`unexpected: ${String(value)}`);
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function encodeCanonical(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean": case "string": return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("INVALID_CANONICAL_VALUE");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(encodeCanonical).join(",")}]`;
      if (!isPlainRecord(value)) throw new Error("INVALID_CANONICAL_VALUE");
      const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${encodeCanonical(value[key])}`).join(",")}}`;
    }
    default: throw new Error("INVALID_CANONICAL_VALUE");
  }
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(encodeCanonical(value)).digest("hex");
}

export function capabilityContextHash(context: CapabilityContext): string {
  return sha256Canonical(context);
}

function parseHash(value: string): string {
  if (!HASH_PATTERN.test(value)) throw new Error("INVALID_INPUT");
  return value;
}

export function storedProbeProof(input: CapabilityProof): CapabilityProof {
  if (!OBSERVED_AT_PATTERN.test(input.observedAt) || input.modelId.trim() === "") throw new Error("INVALID_INPUT");
  return {
    modelId: input.modelId, contextHash: parseHash(input.contextHash), evidenceHash: parseHash(input.evidenceHash),
    observedAt: input.observedAt, requestHashes: input.requestHashes.map(parseHash),
    responseHashes: input.responseHashes.map(parseHash), text: input.text, tools: input.tools,
    opaqueRoundtrip: input.opaqueRoundtrip, imageOutput: input.imageOutput, imageReference: input.imageReference,
  };
}

export function inspectStoredAuth(credentials: Credentials | null, now: number): AuthState {
  if (credentials === null) return { kind: "missing" };
  if (now >= credentials.expires) {
    return credentials.email === undefined
      ? { kind: "expired", providerProjectId: credentials.projectId }
      : { kind: "expired", accountScope: credentials.email, providerProjectId: credentials.projectId };
  }
  if (credentials.email === undefined || credentials.email.trim() === "" || credentials.projectId.trim() === "") {
    return { kind: "missing" };
  }
  return { kind: "present", accountScope: credentials.email.trim().toLowerCase(), providerProjectId: credentials.projectId };
}

function exactEntry(models: readonly ModelEntry[], modelId: string): ModelEntry | undefined {
  for (const entry of models) {
    if (entry.id === modelId) return entry;
  }
  return undefined;
}

function blocked(block: CapabilityBlock): FeatureReadiness {
  return { status: "blocked", block };
}

function featureVerified(feature: "text" | "tools" | "imageOutput" | "imageReference", proof: CapabilityProof): boolean {
  const roundtrip = proof.requestHashes.length >= 2 && proof.responseHashes.length >= 2;
  switch (feature) {
    case "text": return proof.text;
    case "tools": return proof.tools && proof.opaqueRoundtrip && roundtrip;
    case "imageOutput": return proof.imageOutput;
    case "imageReference": return proof.imageOutput && proof.imageReference && roundtrip;
    default: return assertNever(feature);
  }
}

function evaluateFeature(
  auth: AuthState, modelId: string, entry: ModelEntry | undefined,
  feature: "text" | "tools" | "imageOutput" | "imageReference",
  contextHash: string, proofs: readonly CapabilityProof[],
): FeatureReadiness {
  switch (auth.kind) {
    case "missing": return blocked({ kind: "auth", code: "AUTH_REQUIRED" });
    case "expired": return blocked({ kind: "auth", code: "AUTH_EXPIRED" });
    case "present": break;
    default: return assertNever(auth);
  }
  switch (feature) {
    case "imageOutput":
    case "imageReference":
      if (modelId !== PRODUCTION_IMAGE_MODEL_ID) return blocked({ kind: "capability", code: "VISION_ONLY" });
      break;
    case "text":
    case "tools":
      if (modelId !== PRODUCTION_TEXT_MODEL_ID) return blocked({ kind: "capability", code: "CONFIG_MODEL_MISMATCH" });
      break;
    default: return assertNever(feature);
  }
  if (entry === undefined) return blocked({ kind: "capability", code: "MODEL_MISSING" });
  if (entry.quotaInfo?.remainingFraction === 0) return blocked({ kind: "quota", code: "QUOTA", remainingFraction: 0 });
  const candidates = proofs.filter((item) => item.modelId === modelId);
  const matched = candidates.find((item) => item.contextHash === contextHash);
  if (matched === undefined) {
    return candidates.length > 0
      ? blocked({ kind: "capability", code: "PROBE_STALE" })
      : { status: "unverified", reason: "live-probe-required" };
  }
  if (!featureVerified(feature, matched)) return blocked({ kind: "capability", code: "PROBE_FAILED" });
  return { status: "ready", evidenceHash: matched.evidenceHash };
}

function modelReady(modelId: string, text: FeatureReadiness, tools: FeatureReadiness, imageOutput: FeatureReadiness, imageReference: FeatureReadiness): boolean {
  if (modelId === PRODUCTION_TEXT_MODEL_ID) return text.status === "ready" && tools.status === "ready";
  if (modelId === PRODUCTION_IMAGE_MODEL_ID) return imageOutput.status === "ready" && imageReference.status === "ready";
  return false;
}

function evaluateModel(
  auth: AuthState, context: CapabilityContext, modelId: string, models: readonly ModelEntry[],
  proofs: readonly CapabilityProof[], counters: readonly CounterObservation[], contextHash: string,
): ModelReadiness {
  const entry = exactEntry(models, modelId);
  const text = evaluateFeature(auth, modelId, entry, "text", contextHash, proofs);
  const tools = evaluateFeature(auth, modelId, entry, "tools", contextHash, proofs);
  const imageOutput = evaluateFeature(auth, modelId, entry, "imageOutput", contextHash, proofs);
  const imageReference = evaluateFeature(auth, modelId, entry, "imageReference", contextHash, proofs);
  const ready = modelReady(modelId, text, tools, imageOutput, imageReference);
  const matched = proofs.find((item) => item.modelId === modelId && item.contextHash === contextHash);
  const quota = entry?.quotaInfo;
  const accountScope = auth.kind === "present" || auth.kind === "expired" ? auth.accountScope ?? context.accountScope : context.accountScope;
  const providerProjectId = auth.kind === "present" || auth.kind === "expired" ? auth.providerProjectId : context.providerProjectId;
  return {
    modelId, present: entry !== undefined, inputVision: entry?.supportsImages === true,
    remainingFraction: quota?.remainingFraction ?? null,
    resetTime: quota?.resetTime === undefined ? null : quota.resetTime,
    text, tools, imageOutput, imageReference,
    binding: {
      accountScope, providerProjectId, modelId, configDigest: context.configDigest,
      evidenceHash: sha256Canonical({ contextHash, proof: matched ?? null }),
      ...tokenBindingFields(entry, observedExactUsage(counters, modelId, contextHash)), ready,
    },
  };
}

export function evaluateCapabilities(input: CapabilityInput): CapabilityReport {
  void input.upstream;
  const contextHash = capabilityContextHash(input.context);
  const counters = input.counters ?? [];
  const text = evaluateModel(input.auth, input.context, input.context.textModelId, input.models, input.proofs, counters, contextHash);
  const image = evaluateModel(input.auth, input.context, input.context.imageModelId, input.models, input.proofs, counters, contextHash);
  return {
    context: input.context, contextHash, text, image,
    productionReady: text.binding.ready && image.binding.ready,
    liveVerification: input.proofs.length > 0 ? "performed" : "not-performed",
  };
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isPlainRecord(value)) return undefined;
  return value;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function collectOpaqueReplayParts(chunks: readonly unknown[]): readonly unknown[] {
  const parts: unknown[] = [];
  for (const chunk of chunks) {
    for (const candidate of readArray(readObject(readObject(chunk)?.["response"])?.["candidates"])) {
      for (const part of readArray(readObject(readObject(candidate)?.["content"])?.["parts"])) {
        if (readObject(part)?.["thought"] === true) continue;
        parts.push(part);
      }
    }
  }
  return parts;
}
