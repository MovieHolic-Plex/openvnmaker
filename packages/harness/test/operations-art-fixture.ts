import assert from "node:assert/strict";
import {
  admitBudget, canonicalBytes, canonicalHash, DEFAULT_BUDGET_LIMITS,
  parseBudgetRequest, parseEffect, parseToolEnvelope, writeSetSchema,
} from "../src/index.js";
import type { PreparedArtIntent } from "../src/operations-art.js";
import { budgetInput } from "./fixtures.js";
import { projectFixture } from "./operations-project-fixture.js";

export async function artFixture() {
  const f = await projectFixture();
  const args = {
    assetRequestId: "art-bg-start", kind: "background",
    target: { kind: "scene", sceneId: "start", slot: "background" },
    referenceBindingIds: [], brief: "Synthetic frame",
  } as const;
  const envelope = parseToolEnvelope({ ...f.common, tool: "request_art", arguments: args });
  const capability = { ...budgetInput.capability, modelId: "synthetic-image-fixture" };
  const payload = { model: capability.modelId, prompt: args.brief, width: 1024, height: 1024 };
  const [capabilityBindingHash, requestPayloadHash] = await Promise.all([
    canonicalHash(capability), canonicalHash(payload),
  ]);
  const bytes = canonicalBytes(payload).byteLength;
  const budgetRequest = parseBudgetRequest({
    ...budgetInput, limits: DEFAULT_BUDGET_LIMITS,
    capability, capabilityBindingHash, requestPayloadHash,
    textContextBytes: bytes, wireBodyBytes: bytes,
    counter: {
      ...budgetInput.counter, capabilityBindingHash, requestPayloadHash, inputTokens: 50,
    },
    reserve: { textAttempts: 0, imageAttempts: 1, countRequests: 0 },
  });
  const admission = admitBudget(budgetRequest);
  assert.equal(admission.allowed, true);
  const effect = parseEffect({
    state: "intent", effectId: "00000000-0000-4000-8000-000000000060",
    payloadHash: requestPayloadHash, admission,
  });
  assert.equal(effect.state, "intent");
  const preparedArt: PreparedArtIntent = {
    toolPayloadHash: await canonicalHash({ unitId: f.input.unitId, envelope }),
    effect,
  };
  assert.notEqual(preparedArt.toolPayloadHash, effect.payloadHash);
  const input = {
    ...f.input, preparedArt,
    authorizedWriteSet: writeSetSchema.parse([{
      target: { kind: "asset", assetId: args.assetRequestId }, fields: ["request"],
    }]),
  };
  return { ...f, args, envelope, input, preparedArt, budgetRequest };
}
