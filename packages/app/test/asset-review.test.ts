import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript, type VnScript } from "@vnmaker/content";
import {
  decodePng, deriveSpriteDelivery, encodeRgbaPng, hashBytes, hashSchema, inspectImageBytes,
  parseProductionDocument, PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID,
  type ProductionDocument, type Sha256,
} from "@vnmaker/harness";
import { historyReducer, type HistoryState } from "../src/studio/project.js";
import {
  adoptPending, attachAssetById, authorizeUnknownRetry, createAssetReviewSession,
  evaluatePixelReview, generationGate, parseAssetReview, pixelReviewFromMetadata,
  reduceAssetReview, referenceHashesAlign, serializeAssetReview, shouldApplyLegacyGreenKey,
  type PendingAsset,
} from "../src/studio/harness/assetReviewModel.js";

const HASH = {
  seorin: hashSchema.parse("a".repeat(64)),
  dohyun: hashSchema.parse("b".repeat(64)),
  output: hashSchema.parse("c".repeat(64)),
  other: hashSchema.parse("d".repeat(64)),
};

function scriptOf(): VnScript {
  return parseScript({
    title: "Asset review", subtitle: "", start: "lab",
    characters: [
      { id: "seorin", name: "서린", color: "#88aaff", bio: "painter" },
      { id: "dohyun", name: "도현", color: "#ffaa88", bio: "friend" },
    ],
    scenes: [{
      id: "lab", background: "title", chapter: "1",
      lines: [{ speaker: "seorin", text: "Studio lights." }],
      sprites: [{ slot: "center", character: "seorin", expression: "neutral" }],
      ending: "End",
    }],
  });
}

function documentOf(script: VnScript): ProductionDocument {
  return parseProductionDocument({
    version: 1, brief: "brief", castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title: script.title, subtitle: "", bible: "bible", start: script.start, scenes: [] },
    artDirection: [], referenceBindings: [],
  });
}

function pending(overrides: Partial<PendingAsset> = {}): PendingAsset {
  return {
    assetId: "expr-seorin-smile", name: "서린 미소", role: "expression",
    target: { kind: "character", characterId: "seorin" }, characterId: "seorin", expression: "smile",
    originalHash: HASH.output, deliveryHash: HASH.output, referenceHash: HASH.seorin,
    compositing: "alpha", url: "/assets/sprite/seorin-smile.png",
    registered: true, outcome: "succeeded", pixelKind: "decoded",
    ...overrides,
  };
}

function headerOnlyPng(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes[16] = 0; bytes[17] = 0; bytes[18] = 0; bytes[19] = 8;
  bytes[20] = 0; bytes[21] = 0; bytes[22] = 0; bytes[23] = 8;
  return bytes;
}

function rgba(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y);
      const index = (y * width + x) * 4;
      bytes[index] = color[0]; bytes[index + 1] = color[1]; bytes[index + 2] = color[2]; bytes[index + 3] = color[3];
    }
  }
  return bytes;
}

test("approved-reference-hash-equality", () => {
  const session = reduceAssetReview(createAssetReviewSession(scriptOf(), documentOf(scriptOf())), {
    kind: "approve-reference", characterId: "seorin", originalHash: HASH.seorin, versionId: "ref-seorin-v1",
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;
  const generated = reduceAssetReview(session.session, { kind: "queue-generated", asset: pending() });
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const requestHash = generated.session.pending?.referenceHash;
  const receiptHash = generated.session.pending?.referenceHash;
  const approved = generated.session.approvedReferences[0]?.originalHash;
  assert.equal(approved, HASH.seorin);
  assert.equal(referenceHashesAlign({ approved: HASH.seorin, request: requestHash ?? HASH.other, receipt: receiptHash ?? HASH.other }), true);
  assert.equal(referenceHashesAlign({ approved: HASH.seorin, request: HASH.other, receipt: HASH.seorin }), false);
});

test("refuse-foreign-reference-failed-output-unregistered-bytes", () => {
  const base = createAssetReviewSession(scriptOf(), documentOf(scriptOf()));
  const approved = reduceAssetReview(base, {
    kind: "approve-reference", characterId: "seorin", originalHash: HASH.seorin, versionId: "ref-seorin-v1",
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const foreign = adoptPending(approved.session, pending({
    assetId: "expr-dohyun", characterId: "dohyun", referenceHash: HASH.dohyun,
    target: { kind: "character", characterId: "dohyun" },
  }));
  assert.equal(foreign.ok, false);
  if (foreign.ok) return;
  assert.equal(foreign.reason, "FOREIGN_REFERENCE");
  const failed = adoptPending(approved.session, pending({ outcome: "failed" }));
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.reason, "FAILED_OUTPUT");
  const unknown = adoptPending(approved.session, pending({ outcome: "unknown" }));
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.reason, "UNKNOWN_OUTPUT");
  const unregistered = adoptPending(approved.session, pending({ registered: false }));
  assert.equal(unregistered.ok, false);
  if (unregistered.ok) return;
  assert.equal(unregistered.reason, "UNREGISTERED_BYTES");
  assert.equal(approved.session.adoptedAssetIds.length, 0);
  assert.equal(approved.session.script.assets, undefined);
});

test("adopted-asset-survives-reload-and-undo", () => {
  const start = createAssetReviewSession(scriptOf(), documentOf(scriptOf()));
  const approved = reduceAssetReview(start, {
    kind: "approve-reference", characterId: "seorin", originalHash: HASH.seorin, versionId: "ref-seorin-v1",
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const queued = reduceAssetReview(approved.session, { kind: "queue-generated", asset: pending() });
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  const adopted = reduceAssetReview(queued.session, { kind: "adopt" });
  assert.equal(adopted.ok, true);
  if (!adopted.ok) return;
  assert.equal(adopted.session.adoptedAssetIds.includes("expr-seorin-smile"), true);
  assert.equal(adopted.session.script.assets?.some(asset => asset.id === "expr-seorin-smile"), true);
  const restored = parseAssetReview(JSON.parse(serializeAssetReview(adopted.session)), scriptOf(), documentOf(scriptOf()));
  assert.equal(restored.adoptedAssetIds.includes("expr-seorin-smile"), true);
  assert.equal(restored.script.assets?.some(asset => asset.id === "expr-seorin-smile"), true);
  const later = parseScript({ ...adopted.session.script, title: "later title" });
  let history: HistoryState = { past: [], present: start.script, future: [] };
  history = historyReducer(history, { type: "edit", script: adopted.session.script, at: 1 });
  history = historyReducer(history, { type: "edit", script: later, at: 5000 });
  history = historyReducer(history, { type: "undo" });
  assert.equal(history.present.title, "Asset review");
  assert.equal(history.present.assets?.some(asset => asset.id === "expr-seorin-smile"), true);
  const preview = history.present.characters.find(character => character.id === "seorin")?.expressionImages?.smile;
  assert.equal(preview, "/assets/sprite/seorin-smile.png");
});

test("scene-attachment-by-id", () => {
  const start = scriptOf();
  const cg = { id: "cg-lab-1", name: "Lab CG", kind: "cg" as const, url: "/assets/art/rain-confession-cg.png" };
  const background = { id: "bg-lab-1", name: "Lab night", kind: "background" as const, url: "/assets/art/nocturne-atrium.png" };
  const pose = { id: "pose-seorin-1", name: "pose", kind: "character" as const, url: "/assets/sprite/seorin-neutral.png", characterId: "seorin" as const };
  const expression = { id: "expr-seorin-smile", name: "smile", kind: "character" as const, url: "/assets/sprite/seorin-smile.png", characterId: "seorin" as const, expression: "smile" as const };
  let next = parseScript({ ...start, assets: [cg, background, pose, expression] });
  next = attachAssetById(next, "lab", "cg-lab-1", "cg");
  assert.equal(next.scenes[0]?.cg, "cg-lab-1");
  assert.equal(next.scenes[0]?.cgUrl, cg.url);
  next = attachAssetById(next, "lab", "bg-lab-1", "background");
  assert.equal(next.scenes[0]?.backgroundUrl, background.url);
  assert.equal(next.scenes[0]?.cgUrl, undefined);
  next = attachAssetById(next, "lab", "pose-seorin-1", "pose");
  assert.equal(next.scenes[0]?.sprites?.[0]?.poseUrl, pose.url);
  next = attachAssetById(next, "lab", "expr-seorin-smile", "expression");
  assert.equal(next.characters.find(character => character.id === "seorin")?.expressionImages?.smile, expression.url);
});

test("reference-incapable-model-blocked", () => {
  const ready = generationGate({
    imageModelId: PRODUCTION_IMAGE_MODEL_ID, textModelId: PRODUCTION_TEXT_MODEL_ID,
    imageOutputStatus: "ready", imageReferenceStatus: "ready", wantsReference: true,
  });
  assert.equal(ready.ok, true);
  const vision = generationGate({
    imageModelId: PRODUCTION_TEXT_MODEL_ID, textModelId: PRODUCTION_TEXT_MODEL_ID,
    imageOutputStatus: "ready", imageReferenceStatus: "ready", wantsReference: true,
  });
  assert.equal(vision.ok, false);
  if (vision.ok) return;
  assert.equal(vision.reason, "VISION_ONLY");
  const blocked = generationGate({
    imageModelId: PRODUCTION_IMAGE_MODEL_ID, textModelId: PRODUCTION_TEXT_MODEL_ID,
    imageOutputStatus: "ready", imageReferenceStatus: "blocked", wantsReference: true,
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.reason, "CAPABILITY_REQUIRED");
  const missing = generationGate({
    imageModelId: "unknown-image-model", textModelId: PRODUCTION_TEXT_MODEL_ID,
    imageOutputStatus: "ready", imageReferenceStatus: "ready", wantsReference: true,
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.reason, "MODEL_MISSING");
});

test("unknown-effect-requires-explicit-retry", () => {
  const start = createAssetReviewSession(scriptOf(), documentOf(scriptOf()));
  const marked = reduceAssetReview(start, {
    kind: "mark-unknown", effectId: "00000000-0000-4000-8000-000000000018", payloadHash: HASH.output,
  });
  assert.equal(marked.ok, true);
  if (!marked.ok) return;
  const denied = authorizeUnknownRetry(marked.session, {
    effectId: "00000000-0000-4000-8000-000000000018", payloadHash: HASH.output, authorizeReplacement: false,
  });
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.reason, "AUTHORIZATION_REQUIRED");
  const allowed = authorizeUnknownRetry(marked.session, {
    effectId: "00000000-0000-4000-8000-000000000018", payloadHash: HASH.output, authorizeReplacement: true,
  });
  assert.equal(allowed.ok, true);
  const mismatch = authorizeUnknownRetry(marked.session, {
    effectId: "00000000-0000-4000-8000-000000000019", payloadHash: HASH.output, authorizeReplacement: true,
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.reason, "UNKNOWN_EFFECT");
});

test("alpha-derivative-not-rekeyed-as-green", async () => {
  assert.equal(shouldApplyLegacyGreenKey("alpha"), false);
  assert.equal(shouldApplyLegacyGreenKey("opaque"), false);
  assert.equal(shouldApplyLegacyGreenKey("legacy-chroma-key"), true);
  const original = await encodeRgbaPng(8, 8, rgba(8, 8, (x) => x < 4 ? [0, 255, 0, 128] : [40, 40, 200, 255]));
  const derived = await deriveSpriteDelivery(original);
  assert.equal(derived.action.record.compositing, "alpha");
  assert.equal(derived.action.transformId, "alpha-preserve-v1");
  assert.equal(shouldApplyLegacyGreenKey(derived.action.record.compositing), false);
  const decoded = await decodePng(derived.bytes);
  assert.equal(decoded.rgba[3], 128);
  assert.equal(decoded.rgba[0], 0);
  assert.equal(decoded.rgba[1], 255);
});

test("header-only-image-bytes-not-pixel-pass", async () => {
  const header = headerOnlyPng();
  const inspected = inspectImageBytes(header);
  assert.equal(inspected.mime, "image/png");
  assert.equal(inspected.width, 8);
  assert.equal(inspected.height, 8);
  const fromMeta = pixelReviewFromMetadata(inspected);
  assert.equal(fromMeta.kind, "unverified");
  const review = await evaluatePixelReview(header);
  assert.equal(review.kind, "unverified");
  if (review.kind !== "unverified") return;
  assert.equal(review.reason, "header-only");
  const pixels = await encodeRgbaPng(4, 4, rgba(4, 4, () => [10, 20, 30, 255]));
  const hashed: Sha256 = await hashBytes(pixels);
  assert.equal(hashed.length, 64);
  const decoded = await evaluatePixelReview(pixels);
  assert.equal(decoded.kind, "pass");
  const start = createAssetReviewSession(scriptOf(), documentOf(scriptOf()));
  const approved = reduceAssetReview(start, {
    kind: "approve-reference", characterId: "seorin", originalHash: HASH.seorin, versionId: "ref-seorin-v1",
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const refused = adoptPending(approved.session, pending({ pixelKind: "header-only" }));
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.reason, "PIXEL_UNVERIFIED");
});
