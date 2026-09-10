import { canonicalHash } from "./canonical.js";
import { assertNever, uuidSchema } from "./primitives.js";
import type { Sha256 } from "./primitives.js";
import { hashBytes, inspectImageBytes, isHtmlOrXmlBytes } from "./image-inspect.js";
import { decodePng } from "./image-png.js";
import { prepareSentReference } from "./image-sent.js";
import { imageArtifactReceiptSchema, imageCapabilitySchema, imageEffectOutcomeSchema } from "./image-contracts.js";
import type {
  ImageArtifactReceipt, ImageCapability, ImageEffectOutcome, ImageFailureReason, PublicProvenance,
} from "./image-contracts.js";
import type { ArtRole, ArtTarget } from "./production-contracts.js";
import type { HarnessErrorCode } from "./primitives.js";

export type ImageTransportRequest = {
  readonly effectId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly references: readonly { readonly originalHash: Sha256; readonly sentHash: Sha256; readonly bytes: Uint8Array }[];
};
export type ImageTransportResult =
  | { readonly kind: "inline"; readonly mime: string; readonly bytes: Uint8Array }
  | { readonly kind: "remote-url"; readonly url: string }
  | { readonly kind: "disconnected" }
  | { readonly kind: "unsupported-reference" };
export type ImageTransport = { generate(request: ImageTransportRequest): Promise<ImageTransportResult> };
export type ImageByteStore = {
  get(hash: string): Promise<Uint8Array | null>;
  putOriginal(hash: string, bytes: Uint8Array): Promise<"stored" | "exists">;
  putDelivery(hash: string, bytes: Uint8Array): Promise<"stored" | "exists">;
};
export type StoredImageEffect =
  | { readonly state: "succeeded"; readonly payloadHash: Sha256; readonly artifact: ImageArtifactReceipt; readonly reservation: { readonly imageAttempts: number } }
  | { readonly state: "unknown"; readonly payloadHash: Sha256; readonly reason: string; readonly reservation: { readonly imageAttempts: number } }
  | { readonly state: "known-failed"; readonly payloadHash: Sha256; readonly reason: ImageFailureReason; readonly code: HarnessErrorCode; readonly reservation: { readonly imageAttempts: number } };
export type ImageEffectStore = {
  get(effectId: string): Promise<StoredImageEffect | undefined>;
  put(effectId: string, record: StoredImageEffect): Promise<void>;
};
export type ImageEffectRequest = {
  readonly effectId: string;
  readonly modelId: string;
  readonly role: ArtRole;
  readonly target: ArtTarget;
  readonly privatePrompt: string;
  readonly publicProvenance: PublicProvenance;
  readonly references: readonly { readonly bindingId: string; readonly originalHash: Sha256 }[];
  readonly referenceMaxEdge: number;
};
export type ImageEffectDeps = {
  readonly transport: ImageTransport;
  readonly bytes: ImageByteStore;
  readonly effects: ImageEffectStore;
  readonly capability: ImageCapability;
};

export async function imagePayloadHash(request: ImageEffectRequest): Promise<Sha256> {
  return canonicalHash({
    modelId: request.modelId, role: request.role, target: request.target, privatePrompt: request.privatePrompt,
    references: request.references, referenceMaxEdge: request.referenceMaxEdge,
  });
}

export function isProposalUsable(outcome: ImageEffectOutcome): boolean {
  switch (outcome.kind) {
    case "succeeded": case "duplicate": return outcome.artifact.proposalUsable;
    case "payload-mismatch": case "unsupported-reference": case "unknown": case "known-failed": return false;
    default: return assertNever(outcome);
  }
}

async function fail(
  deps: ImageEffectDeps, effectId: string, payloadHash: Sha256, reason: ImageFailureReason, code: HarnessErrorCode, upstreamCalls: number,
): Promise<ImageEffectOutcome> {
  const reservation = { imageAttempts: upstreamCalls };
  await deps.effects.put(effectId, { state: "known-failed", payloadHash, reason, code, reservation });
  return imageEffectOutcomeSchema.parse({ kind: "known-failed", effectId, code, reason, reservation, upstreamCalls });
}

export async function runImageEffect(request: ImageEffectRequest, deps: ImageEffectDeps): Promise<ImageEffectOutcome> {
  imageCapabilitySchema.parse(deps.capability);
  const effectId = uuidSchema.parse(request.effectId);
  const payloadHash = await imagePayloadHash(request);
  const existing = await deps.effects.get(effectId);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      return imageEffectOutcomeSchema.parse({ kind: "payload-mismatch", effectId, code: "ID_PAYLOAD_CONFLICT", upstreamCalls: 0 });
    }
    switch (existing.state) {
      case "succeeded":
        return imageEffectOutcomeSchema.parse({ kind: "duplicate", effectId, artifact: existing.artifact, upstreamCalls: 0 });
      case "unknown":
        return imageEffectOutcomeSchema.parse({ kind: "unknown", effectId, reason: existing.reason, reservation: existing.reservation, upstreamCalls: 0 });
      case "known-failed":
        return imageEffectOutcomeSchema.parse({ kind: "known-failed", effectId, code: existing.code, reason: existing.reason, reservation: existing.reservation, upstreamCalls: 0 });
      default: return assertNever(existing);
    }
  }
  if (deps.capability.imageOutput !== "ready" || (request.references.length > 0 && deps.capability.imageReference !== "ready")) {
    return imageEffectOutcomeSchema.parse({ kind: "unsupported-reference", effectId, code: "CAPABILITY_REQUIRED", upstreamCalls: 0 });
  }
  const sent = [];
  const lineage = [];
  for (const binding of request.references) {
    const original = await deps.bytes.get(binding.originalHash);
    if (original === null) return fail(deps, effectId, payloadHash, "unverified", "INVALID_INPUT", 0);
    const prepared = await prepareSentReference(original, request.referenceMaxEdge);
    sent.push({ originalHash: prepared.originalHash, sentHash: prepared.sentHash, bytes: prepared.bytes });
    lineage.push({
      bindingId: binding.bindingId, originalHash: prepared.originalHash, sentHash: prepared.sentHash,
      mime: prepared.mime, width: prepared.width, height: prepared.height, rawBytes: prepared.rawBytes,
    });
  }
  const result = await deps.transport.generate({
    effectId, modelId: request.modelId, prompt: request.privatePrompt, references: sent,
  });
  switch (result.kind) {
    case "disconnected": {
      const reservation = { imageAttempts: 1 };
      await deps.effects.put(effectId, { state: "unknown", payloadHash, reason: "disconnected", reservation });
      return imageEffectOutcomeSchema.parse({ kind: "unknown", effectId, reason: "disconnected", reservation, upstreamCalls: 1 });
    }
    case "remote-url": return fail(deps, effectId, payloadHash, "remote-url", "INVALID_INPUT", 1);
    case "unsupported-reference": return fail(deps, effectId, payloadHash, "unverified", "CAPABILITY_REQUIRED", 1);
    case "inline": {
      if (isHtmlOrXmlBytes(result.bytes)) return fail(deps, effectId, payloadHash, "html", "INVALID_INPUT", 1);
      try {
        const inspected = inspectImageBytes(result.bytes);
        if (inspected.mime === "image/png") await decodePng(result.bytes);
        const originalHash = await hashBytes(result.bytes);
        await deps.bytes.putOriginal(originalHash, result.bytes);
        await deps.bytes.putDelivery(originalHash, result.bytes);
        const artifact = imageArtifactReceiptSchema.parse({
          artifactId: globalThis.crypto.randomUUID(), hash: originalHash, bytes: result.bytes.byteLength,
          originalHash, deliveryHash: originalHash, sentHashes: lineage.map(entry => entry.sentHash),
          modelId: request.modelId, mime: inspected.mime, width: inspected.width, height: inspected.height,
          role: request.role, target: request.target, referenceLineage: lineage,
          compositing: request.role === "expression" || request.role === "pose" ? "alpha" : "opaque",
          publicProvenance: request.publicProvenance, verified: true, proposalUsable: true,
        });
        const reservation = { imageAttempts: 1 };
        await deps.effects.put(effectId, { state: "succeeded", payloadHash, artifact, reservation });
        return imageEffectOutcomeSchema.parse({ kind: "succeeded", effectId, artifact, reservation, upstreamCalls: 1 });
      } catch {
        return fail(deps, effectId, payloadHash, "corrupt", "INVALID_INPUT", 1);
      }
    }
    default: return assertNever(result);
  }
}
