import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryStore } from "../src/auth/credentials.js";
import { mapModels } from "../src/cca/client.js";
import {
  PRODUCTION_IMAGE_MODEL_ID,
  PRODUCTION_TEXT_MODEL_ID,
  capabilityContextHash,
  evaluateCapabilities,
  inspectStoredAuth,
  storedProbeProof,
} from "../src/cca/capabilities.js";
import type { AuthState, CapabilityContext, CapabilityProof, CapabilityUpstream } from "../src/cca/capabilities.js";

const textModelId = "gemini-3.8-flash-high";
const imageModelId = "gemini-3.1-flash-image";
const configDigest = "a".repeat(64);
const context: CapabilityContext = {
  accountScope: "account-a",
  providerProjectId: "project-a",
  configDigest,
  textModelId,
  imageModelId,
};
const presentAuth: AuthState = { kind: "present", accountScope: "account-a", providerProjectId: "project-a" };
const catalogue = mapModels({
  [textModelId]: { supportsImages: true },
  [imageModelId]: { supportsImages: true },
});

function unusedUpstream(): CapabilityUpstream & { readonly calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    generate: async () => {
      state.calls += 1;
      throw new Error("fixture evaluation must not generate");
    },
  };
}

function proof(modelId: string, contextHash: string, flags: Pick<CapabilityProof, "text" | "tools" | "opaqueRoundtrip" | "imageOutput" | "imageReference">): CapabilityProof {
  return storedProbeProof({
    modelId,
    contextHash,
    evidenceHash: modelId === textModelId ? "b".repeat(64) : "c".repeat(64),
    observedAt: "2026-09-09T00:00:00.000Z",
    requestHashes: ["d".repeat(64), "e".repeat(64)],
    responseHashes: ["f".repeat(64), "0".repeat(64)],
    ...flags,
  });
}

test("exact-catalog-capabilities: ready only when catalogue key and probe evidence agree", () => {
  // Given: exact production keys, null quota, and stored (not live) probe evidence.
  assert.equal(PRODUCTION_TEXT_MODEL_ID, textModelId);
  assert.equal(PRODUCTION_IMAGE_MODEL_ID, imageModelId);
  assert.notEqual(textModelId, imageModelId);
  const contextHash = capabilityContextHash(context);
  const textProof = proof(textModelId, contextHash, { text: true, tools: true, opaqueRoundtrip: true, imageOutput: false, imageReference: false });
  const imageProof = proof(imageModelId, contextHash, { text: false, tools: false, opaqueRoundtrip: false, imageOutput: true, imageReference: true });
  const proofs = [textProof, imageProof];
  const upstream = unusedUpstream();
  // When
  const agreed = evaluateCapabilities({ auth: presentAuth, context, models: catalogue, proofs, upstream });
  const suffixMismatch = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, upstream,
    proofs: [{ ...textProof, modelId: "gemini-3.8-flash" }, imageProof],
  });
  const staleAccount = evaluateCapabilities({
    auth: presentAuth, models: catalogue, proofs, upstream,
    context: { ...context, accountScope: "account-b" },
  });
  const staleConfig = evaluateCapabilities({
    auth: presentAuth, models: catalogue, proofs, upstream,
    context: { ...context, configDigest: "1".repeat(64) },
  });
  const visionFlagWithoutProof = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, proofs: [], upstream,
  });
  const opaqueDropped = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, upstream,
    proofs: [
      proof(textModelId, contextHash, { text: true, tools: true, opaqueRoundtrip: false, imageOutput: false, imageReference: false }),
      imageProof,
    ],
  });
  // Then: both models are surfaced separately, and ready requires exact key + matching evidence.
  assert.equal(agreed.liveVerification, "performed");
  assert.equal(visionFlagWithoutProof.liveVerification, "not-performed");
  assert.equal(agreed.text.modelId, textModelId);
  assert.equal(agreed.image.modelId, imageModelId);
  assert.equal(agreed.text.text.status, "ready");
  assert.equal(agreed.text.tools.status, "ready");
  assert.equal(agreed.image.imageOutput.status, "ready");
  assert.equal(agreed.image.imageReference.status, "ready");
  assert.equal(agreed.productionReady, true);
  assert.equal(agreed.text.remainingFraction, null);
  assert.equal(agreed.image.remainingFraction, null);
  assert.equal(agreed.text.inputVision, true);
  assert.equal(suffixMismatch.productionReady, false);
  assert.notEqual(suffixMismatch.text.text.status, "ready");
  assert.equal(staleAccount.productionReady, false);
  assert.equal(staleAccount.text.text.status, "blocked");
  assert.equal(staleConfig.productionReady, false);
  assert.equal(visionFlagWithoutProof.image.inputVision, true);
  assert.notEqual(visionFlagWithoutProof.image.imageOutput.status, "ready");
  assert.equal(visionFlagWithoutProof.productionReady, false);
  assert.equal(opaqueDropped.text.text.status, "ready");
  assert.notEqual(opaqueDropped.text.tools.status, "ready");
  assert.equal(opaqueDropped.productionReady, false);
  assert.equal(upstream.calls, 0);
});

test("missing-or-vision-only: missing alias, vision-only image model, and expired auth each yield a distinct typed blocked state", async (t) => {
  // Given: fixture catalogue/auth only. Live generation and OAuth must stay at zero.
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls += 1;
    return new Response("upstream", { status: 200 });
  });
  const upstream = unusedUpstream();
  const contextHash = capabilityContextHash(context);
  const proofs = [
    proof(textModelId, contextHash, { text: true, tools: true, opaqueRoundtrip: true, imageOutput: false, imageReference: false }),
    proof(imageModelId, contextHash, { text: false, tools: false, opaqueRoundtrip: false, imageOutput: true, imageReference: true }),
  ];
  const expiredAuth = inspectStoredAuth(
    await createMemoryStore({
      refresh: "fixture-refresh",
      access: "fixture-access",
      expires: 0,
      projectId: "project-a",
      email: "fixture@example.invalid",
    }).read(),
    1,
  );
  // When
  const missingAlias = evaluateCapabilities({
    auth: presentAuth, context, proofs: [], upstream,
    models: mapModels({ [textModelId]: { supportsImages: true } }),
  });
  const visionOnly = evaluateCapabilities({
    auth: presentAuth, proofs: [], upstream,
    context: { ...context, imageModelId: textModelId },
    models: mapModels({ [textModelId]: { supportsImages: true } }),
  });
  const expired = evaluateCapabilities({
    auth: expiredAuth, context, models: catalogue, proofs, upstream,
  });
  // Then
  assert.equal(expiredAuth.kind, "expired");
  assert.equal(missingAlias.image.present, false);
  assert.equal(missingAlias.image.imageOutput.status, "blocked");
  assert.equal(missingAlias.image.imageOutput.status === "blocked" ? missingAlias.image.imageOutput.block.code : null, "MODEL_MISSING");
  assert.equal(visionOnly.image.inputVision, true);
  assert.equal(visionOnly.image.imageOutput.status, "blocked");
  assert.equal(visionOnly.image.imageOutput.status === "blocked" ? visionOnly.image.imageOutput.block.code : null, "VISION_ONLY");
  assert.equal(expired.text.text.status, "blocked");
  assert.equal(expired.text.text.status === "blocked" ? expired.text.text.block.code : null, "AUTH_EXPIRED");
  assert.notEqual(missingAlias.image.imageOutput.status === "blocked" ? missingAlias.image.imageOutput.block.code : null, visionOnly.image.imageOutput.status === "blocked" ? visionOnly.image.imageOutput.block.code : null);
  assert.notEqual(visionOnly.image.imageOutput.status === "blocked" ? visionOnly.image.imageOutput.block.code : null, expired.text.text.status === "blocked" ? expired.text.text.block.code : null);
  assert.notEqual(missingAlias.image.imageOutput.status === "blocked" ? missingAlias.image.imageOutput.block.code : null, expired.text.text.status === "blocked" ? expired.text.text.block.code : null);
  assert.equal(upstream.calls, 0);
  assert.equal(fetchCalls, 0);
});

function blockCode(feature: { readonly status: string; readonly block?: { readonly code: string } }): string | null {
  return feature.status === "blocked" ? feature.block?.code ?? null : null;
}

test("matching proof makes features ready and marks liveVerification performed", () => {
  const contextHash = capabilityContextHash(context);
  const agreed = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, upstream: unusedUpstream(),
    proofs: [
      proof(textModelId, contextHash, { text: true, tools: true, opaqueRoundtrip: true, imageOutput: false, imageReference: false }),
      proof(imageModelId, contextHash, { text: false, tools: false, opaqueRoundtrip: false, imageOutput: true, imageReference: true }),
    ],
  });
  assert.equal(agreed.liveVerification, "performed");
  assert.equal(agreed.text.text.status, "ready");
  assert.equal(agreed.text.tools.status, "ready");
  assert.equal(agreed.image.imageOutput.status, "ready");
  assert.equal(agreed.image.imageReference.status, "ready");
  assert.equal(agreed.productionReady, true);
});

test("proof with a different contextHash is PROBE_STALE", () => {
  const stale = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, upstream: unusedUpstream(),
    proofs: [proof(textModelId, "1".repeat(64), { text: true, tools: true, opaqueRoundtrip: true, imageOutput: false, imageReference: false })],
  });
  assert.equal(blockCode(stale.text.text), "PROBE_STALE");
  assert.equal(stale.liveVerification, "performed");
  assert.notEqual(stale.text.text.status, "ready");
});

test("proof present with feature flag false is PROBE_FAILED", () => {
  const contextHash = capabilityContextHash(context);
  const failed = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, upstream: unusedUpstream(),
    proofs: [proof(textModelId, contextHash, { text: false, tools: false, opaqueRoundtrip: false, imageOutput: false, imageReference: false })],
  });
  assert.equal(blockCode(failed.text.text), "PROBE_FAILED");
  assert.equal(blockCode(failed.text.tools), "PROBE_FAILED");
});

test("no proofs stay unverified and liveVerification not-performed", () => {
  const none = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, proofs: [], upstream: unusedUpstream(),
  });
  assert.equal(none.text.text.status, "unverified");
  assert.equal(none.text.tools.status, "unverified");
  assert.equal(none.image.imageOutput.status, "unverified");
  assert.equal(none.liveVerification, "not-performed");
  assert.equal(none.productionReady, false);
});

test("image bytes absent does not make imageOutput ready", () => {
  const contextHash = capabilityContextHash(context);
  const absent = evaluateCapabilities({
    auth: presentAuth, context, models: catalogue, upstream: unusedUpstream(),
    proofs: [proof(imageModelId, contextHash, { text: false, tools: false, opaqueRoundtrip: false, imageOutput: false, imageReference: false })],
  });
  assert.notEqual(absent.image.imageOutput.status, "ready");
  assert.equal(blockCode(absent.image.imageOutput), "PROBE_FAILED");
});
