import { z } from "zod";
import { uniqueDefinedIdentities } from "./boundary-refinements.js";
import { candidateIdSchema, choiceIdSchema, hashSchema, identifierSchema, projectHeadSchema, projectIdSchema, revisionSchema, runIdSchema, sceneIdSchema, uuidSchema, positiveIntegerSchema } from "./primitives.js";
import { characterSchema, sceneSchema, storyFlagsSchema } from "./content-contracts.js";
import {
  approvedArtBindingSchema, artRoleSchema, artTargetMatchesRole,
  artTargetSchema, productionDocumentSchema,
} from "./production-contracts.js";
import { scriptSchema } from "./script-contracts.js";
import { reviewRecordSchema } from "./review-contracts.js";

export const previewEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("from-start"), sceneId: sceneIdSchema }),
  z.strictObject({ kind: z.literal("assumed-state"), sceneId: sceneIdSchema, flags: storyFlagsSchema }),
]).readonly();
export const previewBoundarySchema = z.strictObject({
  fromSceneId: sceneIdSchema, choiceId: choiceIdSchema.optional(), targetSceneId: sceneIdSchema, reason: z.literal("unwritten-scene"),
}).readonly();
export const previewMissingAssetSchema = z.strictObject({
  assetId: identifierSchema, name: identifierSchema,
  role: artRoleSchema, target: artTargetSchema,
}).refine(asset => artTargetMatchesRole(asset.role, asset.target)).readonly();
export const previewSnapshotSchema = z.strictObject({
  kind: z.literal("candidate-preview"), previewId: uuidSchema, projectId: projectIdSchema, runId: runIdSchema,
  candidateId: candidateIdSchema, candidateRevision: revisionSchema, sourceHead: projectHeadSchema, snapshotHash: hashSchema,
  entry: previewEntrySchema, materializedScenes: z.array(sceneSchema).min(1).max(300)
    .refine(scenes => uniqueDefinedIdentities(scenes.map(scene => scene.id))).readonly(),
  cast: z.array(characterSchema).max(200)
    .refine(cast => uniqueDefinedIdentities(cast.map(character => character.id))).readonly(), initialFlags: storyFlagsSchema,
  assetBindings: z.array(approvedArtBindingSchema).readonly(), boundaries: z.array(previewBoundarySchema).readonly(),
  includedUnitHashes: z.array(hashSchema).readonly(),
  missingAssets: z.array(previewMissingAssetSchema).max(2000).readonly().optional(),
}).refine(snapshot => !snapshot.missingAssets?.some(missing =>
  snapshot.assetBindings.some(binding => binding.assetId === missing.assetId))).readonly();
export const releaseAssetSchema = z.strictObject({
  path: z.string().regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/), hash: hashSchema, size: positiveIntegerSchema,
}).readonly();
export const releaseSnapshotSchema = z.strictObject({
  kind: z.literal("release"), releaseId: hashSchema, sourceHead: projectHeadSchema, sourceScriptHash: hashSchema,
  publicScript: scriptSchema, publicScriptHash: hashSchema, assets: z.array(releaseAssetSchema).readonly(),
  approval: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("production"), digest: hashSchema }),
    z.strictObject({ kind: z.literal("manual-export"), headDigest: hashSchema }),
  ]).readonly(), exporterVersion: identifierSchema, runtimeVersion: identifierSchema,
}).readonly();
export const importedCandidateSeedSchema = z.strictObject({
  productionDocument: productionDocumentSchema, scenes: z.array(sceneSchema).max(300)
    .refine(scenes => uniqueDefinedIdentities(scenes.map(scene => scene.id))).readonly(),
  reviews: z.array(reviewRecordSchema).readonly(), assetManifest: z.array(releaseAssetSchema).readonly(),
  provenance: z.literal("imported"),
}).readonly();
export type PreviewSnapshot = z.infer<typeof previewSnapshotSchema>;
export type PreviewMissingAsset = z.infer<typeof previewMissingAssetSchema>;
export type PreviewBoundary = z.infer<typeof previewBoundarySchema>;
export type ReleaseSnapshot = z.infer<typeof releaseSnapshotSchema>;
export type ImportedCandidateSeed = z.infer<typeof importedCandidateSeedSchema>;
