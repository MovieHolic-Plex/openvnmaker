import { parseScript, type Artwork, type VnScript } from "@vnmaker/content";
import { assertNever, decodePng, hashSchema, inspectImageBytes, parseProductionDocument, PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID, type ArtRole, type ProductionDocument, type Sha256 } from "@vnmaker/harness";
import { applyArtwork, registerArtwork } from "../assets.js";

export type AttachRole = "cg" | "pose" | "expression" | "background";
export type ComparePane = "original" | "delivery" | "reference";
export type InspectionBackground = "checkerboard" | "white" | "black" | "stage";
export type RoleDecision = "reject" | "repair" | "notes";
export type EffectState = "idle" | "unknown" | "authorized-retry";
export type AdoptRefusal = "FOREIGN_REFERENCE" | "FAILED_OUTPUT" | "UNREGISTERED_BYTES" | "HASH_MISMATCH" | "PIXEL_UNVERIFIED" | "ROLE_BLOCKING" | "NO_PENDING" | "UNKNOWN_OUTPUT";
export type GenerationBlock = "VISION_ONLY" | "CAPABILITY_REQUIRED" | "MODEL_MISSING";
export type RetryBlock = "AUTHORIZATION_REQUIRED" | "UNKNOWN_EFFECT" | "IDLE";
export type PixelReview = { readonly kind: "pass"; readonly decoded: true; readonly width: number; readonly height: number } | { readonly kind: "unverified"; readonly reason: "header-only" | "missing" | "undecodable" };
export type PendingTarget = { readonly kind: "character"; readonly characterId: string; readonly expression?: string } | { readonly kind: "scene"; readonly sceneId: string; readonly slot: "background" | "cg" };
export type PendingAsset = {
  readonly assetId: string; readonly name: string; readonly role: ArtRole; readonly target: PendingTarget;
  readonly characterId?: string; readonly expression?: string; readonly originalHash: Sha256; readonly deliveryHash: Sha256;
  readonly referenceHash: Sha256 | null; readonly compositing: "alpha" | "legacy-chroma-key" | "opaque";
  readonly url: string; readonly registered: boolean; readonly outcome: "succeeded" | "failed" | "unknown";
  readonly pixelKind: "decoded" | "header-only" | "missing";
};
export type ApprovedReference = { readonly characterId: string; readonly originalHash: Sha256; readonly versionId: string };
export type RoleVerdict = { readonly role: ArtRole; readonly disposition: "pass" | "changes-required" | "unverified" | "accepted-with-notes"; readonly severity: "blocking" | "repair" | "note" | null };
export type SceneAttachment = { readonly sceneId: string; readonly assetId: string; readonly role: AttachRole };
export type AssetReviewSession = {
  readonly script: VnScript; readonly productionDocument: ProductionDocument;
  readonly approvedReferences: readonly ApprovedReference[]; readonly pending: PendingAsset | null;
  readonly adoptedAssetIds: readonly string[]; readonly sceneAttachments: readonly SceneAttachment[];
  readonly effectState: EffectState; readonly unknownEffectId: string | null; readonly unknownPayloadHash: Sha256 | null;
  readonly roleVerdicts: readonly RoleVerdict[]; readonly comparePane: ComparePane; readonly inspectionBackground: InspectionBackground;
};
export type AssetReviewEvent =
  | { readonly kind: "approve-reference"; readonly characterId: string; readonly originalHash: Sha256; readonly versionId: string }
  | { readonly kind: "queue-generated"; readonly asset: PendingAsset }
  | { readonly kind: "adopt" }
  | { readonly kind: "role-decision"; readonly role: ArtRole; readonly decision: RoleDecision }
  | { readonly kind: "attach"; readonly sceneId: string; readonly assetId: string; readonly role: AttachRole }
  | { readonly kind: "mark-unknown"; readonly effectId: string; readonly payloadHash: Sha256 }
  | { readonly kind: "set-compare"; readonly pane: ComparePane }
  | { readonly kind: "set-inspect"; readonly background: InspectionBackground };
export type SessionResult = { readonly ok: true; readonly session: AssetReviewSession } | { readonly ok: false; readonly reason: string; readonly session: AssetReviewSession };
export type AdoptResult = { readonly ok: true; readonly session: AssetReviewSession } | { readonly ok: false; readonly reason: AdoptRefusal; readonly session: AssetReviewSession };
export const INSPECTION_BACKGROUNDS: readonly InspectionBackground[] = ["checkerboard", "white", "black", "stage"];
export const COMPARE_PANES: readonly ComparePane[] = ["original", "delivery", "reference"];

export function createAssetReviewSession(script: VnScript, document: ProductionDocument): AssetReviewSession {
  return {
    script, productionDocument: document, approvedReferences: [], pending: null, adoptedAssetIds: [], sceneAttachments: [],
    effectState: "idle", unknownEffectId: null, unknownPayloadHash: null, roleVerdicts: [], comparePane: "delivery", inspectionBackground: "checkerboard",
  };
}

export function referenceHashesAlign(input: { readonly approved: Sha256; readonly request: Sha256; readonly receipt: Sha256 }): boolean {
  return input.approved === input.request && input.request === input.receipt;
}

export function generationGate(input: {
  readonly imageModelId: string; readonly textModelId: string; readonly imageOutputStatus: string;
  readonly imageReferenceStatus: string; readonly wantsReference: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly reason: GenerationBlock } {
  if (input.imageModelId === PRODUCTION_TEXT_MODEL_ID) return { ok: false, reason: "VISION_ONLY" };
  if (input.imageModelId !== PRODUCTION_IMAGE_MODEL_ID) return { ok: false, reason: "MODEL_MISSING" };
  if (input.imageOutputStatus !== "ready" || (input.wantsReference && input.imageReferenceStatus !== "ready")) {
    return { ok: false, reason: "CAPABILITY_REQUIRED" };
  }
  return { ok: true };
}

export function shouldApplyLegacyGreenKey(compositing: Artwork["compositing"]): boolean {
  switch (compositing) {
    case "alpha": case "opaque": return false;
    case "legacy-chroma-key": case undefined: return true;
    default: return assertNever(compositing);
  }
}

export function displayChromaKey(compositing: Artwork["compositing"], characterChroma: string | undefined): string | undefined {
  return shouldApplyLegacyGreenKey(compositing) ? characterChroma : undefined;
}
export function pixelReviewFromMetadata(meta: { readonly mime: string; readonly width: number; readonly height: number }): PixelReview {
  void meta;
  return { kind: "unverified", reason: "header-only" };
}

export async function evaluatePixelReview(bytes: Uint8Array): Promise<PixelReview> {
  try { inspectImageBytes(bytes); } catch { return { kind: "unverified", reason: "undecodable" }; }
  try {
    const decoded = await decodePng(bytes);
    return decoded.rgba.length === decoded.width * decoded.height * 4 ? { kind: "pass", decoded: true, width: decoded.width, height: decoded.height } : { kind: "unverified", reason: "undecodable" };
  } catch { return { kind: "unverified", reason: "header-only" }; }
}

function artworkFromPending(asset: PendingAsset): Artwork {
  const kind = asset.role === "background" ? "background" : asset.role === "cg" ? "cg" : "character";
  return {
    id: asset.assetId, name: asset.name, kind, url: asset.url, compositing: asset.compositing,
    ...(asset.characterId === undefined ? {} : { characterId: asset.characterId }),
    ...(asset.expression === undefined ? {} : { expression: asset.expression }),
  };
}

export function adoptionGate(session: AssetReviewSession, asset: PendingAsset): { readonly ok: true } | { readonly ok: false; readonly reason: AdoptRefusal } {
  switch (asset.outcome) {
    case "failed": return { ok: false, reason: "FAILED_OUTPUT" };
    case "unknown": return { ok: false, reason: "UNKNOWN_OUTPUT" };
    case "succeeded": break;
    default: return assertNever(asset.outcome);
  }
  if (!asset.registered) return { ok: false, reason: "UNREGISTERED_BYTES" };
  if (asset.pixelKind !== "decoded") return { ok: false, reason: "PIXEL_UNVERIFIED" };
  if (session.roleVerdicts.some(row => row.severity === "blocking")) return { ok: false, reason: "ROLE_BLOCKING" };
  const characterId = asset.target.kind === "character" ? asset.characterId ?? asset.target.characterId : asset.characterId;
  if (characterId !== undefined) {
    const approved = session.approvedReferences.find(row => row.characterId === characterId);
    if (approved === undefined) return { ok: false, reason: "FOREIGN_REFERENCE" };
    if (asset.referenceHash !== approved.originalHash) return { ok: false, reason: "HASH_MISMATCH" };
  }
  return { ok: true };
}

export function adoptPending(session: AssetReviewSession, asset: PendingAsset): AdoptResult {
  const gate = adoptionGate(session, asset);
  if (!gate.ok) return { ok: false, reason: gate.reason, session };
  const art = artworkFromPending(asset);
  let script = registerArtwork(session.script, art);
  if (asset.role === "expression") script = applyArtwork(script, script.start, art);
  return {
    ok: true,
    session: {
      ...session, script, pending: null, adoptedAssetIds: [...session.adoptedAssetIds, asset.assetId],
      productionDocument: parseProductionDocument({
        ...session.productionDocument,
        referenceBindings: [...session.productionDocument.referenceBindings, {
          assetId: asset.assetId, originalHash: asset.originalHash, deliveryHash: asset.deliveryHash,
          referenceVersionIds: session.approvedReferences.map(row => row.versionId), role: asset.role, target: asset.target,
        }],
      }),
    },
  };
}

export function attachAssetById(script: VnScript, sceneId: string, assetId: string, role: AttachRole): VnScript {
  const asset = script.assets?.find(row => row.id === assetId);
  if (asset === undefined) throw new Error("UNREGISTERED_BYTES");
  switch (role) {
    case "background":
      if (asset.kind !== "background") throw new Error("INVALID_INPUT");
      return applyArtwork(script, sceneId, asset);
    case "cg": {
      if (asset.kind !== "cg") throw new Error("INVALID_INPUT");
      const applied = applyArtwork(script, sceneId, asset);
      return parseScript({ ...applied, scenes: applied.scenes.map(scene => scene.id === sceneId ? { ...scene, cg: assetId } : scene) });
    }
    case "pose": {
      if (asset.kind !== "character" || asset.characterId === undefined) throw new Error("INVALID_INPUT");
      const { expression: _expression, ...pose } = asset;
      return applyArtwork(script, sceneId, pose);
    }
    case "expression":
      if (asset.kind !== "character" || asset.expression === undefined) throw new Error("INVALID_INPUT");
      return applyArtwork(script, sceneId, asset);
    default: return assertNever(role);
  }
}

export function authorizeUnknownRetry(session: AssetReviewSession, input: {
  readonly effectId: string; readonly payloadHash: Sha256; readonly authorizeReplacement: boolean;
}): { readonly ok: true; readonly session: AssetReviewSession } | { readonly ok: false; readonly reason: RetryBlock } {
  if (session.effectState !== "unknown") return { ok: false, reason: "IDLE" };
  if (input.authorizeReplacement !== true) return { ok: false, reason: "AUTHORIZATION_REQUIRED" };
  if (session.unknownEffectId !== input.effectId || session.unknownPayloadHash !== input.payloadHash) return { ok: false, reason: "UNKNOWN_EFFECT" };
  return { ok: true, session: { ...session, effectState: "authorized-retry" } };
}

function roleVerdict(role: ArtRole, decision: RoleDecision): RoleVerdict {
  switch (decision) {
    case "reject": return { role, disposition: "changes-required", severity: "blocking" };
    case "repair": return { role, disposition: "changes-required", severity: "repair" };
    case "notes": return { role, disposition: "accepted-with-notes", severity: "note" };
    default: return assertNever(decision);
  }
}

export function reduceAssetReview(session: AssetReviewSession, event: AssetReviewEvent): SessionResult {
  switch (event.kind) {
    case "approve-reference":
      return { ok: true, session: { ...session, approvedReferences: [...session.approvedReferences.filter(row => row.characterId !== event.characterId), { characterId: event.characterId, originalHash: event.originalHash, versionId: event.versionId }] } };
    case "queue-generated": return { ok: true, session: { ...session, pending: event.asset } };
    case "adopt": return session.pending === null ? { ok: false, reason: "NO_PENDING", session } : adoptPending(session, session.pending);
    case "role-decision":
      return { ok: true, session: { ...session, roleVerdicts: [...session.roleVerdicts.filter(row => row.role !== event.role), roleVerdict(event.role, event.decision)] } };
    case "attach": {
      try {
        const script = attachAssetById(session.script, event.sceneId, event.assetId, event.role);
        return { ok: true, session: { ...session, script, sceneAttachments: [...session.sceneAttachments, { sceneId: event.sceneId, assetId: event.assetId, role: event.role }] } };
      } catch (cause) {
        return { ok: false, reason: cause instanceof Error ? cause.message : "INVALID_INPUT", session };
      }
    }
    case "mark-unknown":
      return { ok: true, session: { ...session, effectState: "unknown", unknownEffectId: event.effectId, unknownPayloadHash: event.payloadHash } };
    case "set-compare": return { ok: true, session: { ...session, comparePane: event.pane } };
    case "set-inspect": return { ok: true, session: { ...session, inspectionBackground: event.background } };
    default: return assertNever(event);
  }
}

export function serializeAssetReview(session: AssetReviewSession): string { return JSON.stringify(session); }

function readHash(value: unknown): Sha256 | null {
  const parsed = hashSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseAssetReview(raw: unknown, fallbackScript: VnScript, fallbackDoc: ProductionDocument): AssetReviewSession {
  const blank = createAssetReviewSession(fallbackScript, fallbackDoc);
  if (typeof raw !== "object" || raw === null) return blank;
  const row = raw as Record<string, unknown>;
  try {
    const approvedReferences = Array.isArray(row["approvedReferences"]) ? row["approvedReferences"].flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return [];
      const entry = item as Record<string, unknown>;
      const originalHash = readHash(entry["originalHash"]);
      if (typeof entry["characterId"] !== "string" || typeof entry["versionId"] !== "string" || originalHash === null) return [];
      return [{ characterId: entry["characterId"], originalHash, versionId: entry["versionId"] }];
    }) : [];
    const sceneAttachments = Array.isArray(row["sceneAttachments"]) ? row["sceneAttachments"].flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return [];
      const entry = item as Record<string, unknown>, role = entry["role"];
      if (typeof entry["sceneId"] !== "string" || typeof entry["assetId"] !== "string") return [];
      switch (role) {
        case "cg": case "pose": case "expression": case "background": return [{ sceneId: entry["sceneId"], assetId: entry["assetId"], role }];
        default: return [];
      }
    }) : [];
    const effectState = row["effectState"] === "unknown" || row["effectState"] === "authorized-retry" ? row["effectState"] : "idle";
    return {
      ...blank, script: parseScript(row["script"] ?? fallbackScript),
      productionDocument: parseProductionDocument(row["productionDocument"] ?? fallbackDoc),
      approvedReferences, sceneAttachments, effectState,
      adoptedAssetIds: Array.isArray(row["adoptedAssetIds"]) ? row["adoptedAssetIds"].filter((id): id is string => typeof id === "string") : [],
      comparePane: row["comparePane"] === "original" || row["comparePane"] === "reference" ? row["comparePane"] : "delivery",
      inspectionBackground: INSPECTION_BACKGROUNDS.find(value => value === row["inspectionBackground"]) ?? "checkerboard",
      unknownEffectId: typeof row["unknownEffectId"] === "string" ? row["unknownEffectId"] : null,
      unknownPayloadHash: readHash(row["unknownPayloadHash"]),
    };
  } catch { return blank; }
}
