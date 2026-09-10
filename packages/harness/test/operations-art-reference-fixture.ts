import assert from "node:assert/strict";
import {
  admitBudget, approvedArtBindingSchema, canonicalBytes, canonicalHash,
  hashSchema, parseBudgetRequest, parseProductionDocument, parseToolEnvelope,
  requestImageSchema,
} from "../src/index.js";
import { artFixture } from "./operations-art-fixture.js";

export async function artReferenceFixture(
  order: readonly ("first" | "second")[] = ["first"],
) {
  const f = await artFixture();
  const bindings = {
    first: approvedArtBindingSchema.parse({
      assetId: "reference-a", originalHash: "a".repeat(64), deliveryHash: "b".repeat(64),
      referenceVersionIds: ["reference-version-a"], role: "background",
      target: { kind: "scene", sceneId: "start", slot: "background" },
    }),
    second: approvedArtBindingSchema.parse({
      assetId: "reference-b", originalHash: "d".repeat(64), deliveryHash: "e".repeat(64),
      referenceVersionIds: ["reference-version-b"], role: "background",
      target: { kind: "scene", sceneId: "end", slot: "background" },
    }),
  };
  const [firstHash, secondHash] = await Promise.all([
    canonicalHash(bindings.first), canonicalHash(bindings.second),
  ]);
  const hashes = { first: firstHash, second: secondHash };
  const imageByKey = {
    first: requestImageSchema.parse({
      originalHash: bindings.first.originalHash, sentHash: hashSchema.parse("c".repeat(64)),
      mime: "image/png", width: 64, height: 64, rawBytes: 1024,
    }),
    second: requestImageSchema.parse({
      originalHash: bindings.second.originalHash, sentHash: hashSchema.parse("f".repeat(64)),
      mime: "image/png", width: 64, height: 64, rawBytes: 1024,
    }),
  };
  const args = { ...f.args, referenceBindingIds: order.map(key => hashes[key]) };
  const envelope = parseToolEnvelope({ ...f.envelope, arguments: args });
  const images = order.map(key => imageByKey[key]);
  const payload = { kind: "synthetic-reference-request", request: args, images };
  const payloadHash = await canonicalHash(payload);
  const admission = admitBudget(parseBudgetRequest({
    ...f.budgetRequest, images, requestPayloadHash: payloadHash,
    textContextBytes: canonicalBytes(payload).byteLength,
    wireBodyBytes: canonicalBytes(payload).byteLength,
    counter: {
      kind: "exact", requestPayloadHash: payloadHash,
      capabilityBindingHash: f.budgetRequest.capabilityBindingHash,
      inputTokens: 100,
      includes: { text: true, tools: true, history: true, opaque: true, images: true },
    },
  }));
  assert.equal(admission.allowed, true);
  const preparedArt = {
    toolPayloadHash: await canonicalHash({ unitId: f.input.unitId, envelope }),
    effect: { ...f.preparedArt.effect, payloadHash, admission },
  };
  const candidate = {
    ...f.input.candidate,
    productionDocument: parseProductionDocument({
      ...f.input.candidate.productionDocument,
      referenceBindings: [bindings.first, bindings.second],
    }),
  };
  return {
    ...f, args, envelope, images, bindings, hashes,
    selected: order.map(key => bindings[key]),
    preparedArt, input: { ...f.input, candidate, preparedArt },
  };
}
