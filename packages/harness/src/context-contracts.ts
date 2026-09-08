import { z } from "zod";
import { characterIdSchema, choiceIdSchema, hashSchema, identifierSchema, lineIdSchema, projectHeadSchema, sceneIdSchema } from "./primitives.js";
import { lineConditionSchema } from "./content-contracts.js";

export const targetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("line"), sceneId: sceneIdSchema, lineId: lineIdSchema }),
  z.strictObject({ kind: z.literal("choice"), sceneId: sceneIdSchema, choiceId: choiceIdSchema }),
  z.strictObject({ kind: z.literal("scene"), sceneId: sceneIdSchema }),
  z.strictObject({ kind: z.literal("character"), characterId: characterIdSchema }),
  z.strictObject({ kind: z.literal("canon"), sectionId: identifierSchema, entryId: identifierSchema.optional() }),
  z.strictObject({ kind: z.literal("asset"), assetId: identifierSchema }),
  z.strictObject({ kind: z.literal("project") }), z.strictObject({ kind: z.literal("state"), flagId: identifierSchema }),
]).readonly();
export const readDependencySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entity"), target: targetSchema, hash: hashSchema }),
  z.strictObject({ kind: z.literal("membership"), scope: targetSchema, ids: z.array(identifierSchema).readonly(), hash: hashSchema }),
  z.strictObject({ kind: z.literal("order"), scope: targetSchema, ids: z.array(identifierSchema).readonly(), hash: hashSchema }),
  z.strictObject({ kind: z.literal("query"), query: identifierSchema, scope: z.array(targetSchema).readonly(), resultIds: z.array(identifierSchema).readonly(), hash: hashSchema }),
]).readonly();
export const readSetSchema = z.array(readDependencySchema).readonly();
export const writeSetSchema = z.array(z.strictObject({ target: targetSchema, fields: z.array(identifierSchema).readonly() }).readonly()).readonly();
export const contextWindowSchema = z.strictObject({
  sceneId: sceneIdSchema, lineIds: z.array(lineIdSchema).max(100).readonly(), hash: hashSchema,
}).readonly();
export const factProvenanceSchema = z.strictObject({
  factId: identifierSchema, sourceHead: projectHeadSchema, sceneIds: z.array(sceneIdSchema).readonly(),
  lineIds: z.array(lineIdSchema).readonly(), sourceHash: hashSchema,
  applicability: z.strictObject({ anyOf: z.array(lineConditionSchema).min(1).max(16).readonly() }).readonly().optional(),
}).readonly();
export const contextManifestSchema = z.strictObject({
  sourceHead: projectHeadSchema, inputContentHash: hashSchema, windows: z.array(contextWindowSchema).readonly(),
  facts: z.array(factProvenanceSchema).readonly(), readSet: readSetSchema,
  referenceBindingHashes: z.array(hashSchema).readonly(),
  excluded: z.array(z.strictObject({ target: targetSchema, reason: identifierSchema }).readonly()).readonly(),
}).readonly();
export type Target = z.infer<typeof targetSchema>;
export type ReadSet = z.infer<typeof readSetSchema>;
export type WriteSet = z.infer<typeof writeSetSchema>;
export type ContextManifest = z.infer<typeof contextManifestSchema>;
