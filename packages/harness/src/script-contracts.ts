import { z } from "zod";
import { parseScript } from "../../content/src/index.js";
import { characterIdSchema, identifierSchema, sceneIdSchema, textSchema } from "./primitives.js";
import { artworkUrlSchema, audioUrlSchema, characterSchema, creditTextSchema, projectMetadataSchema, sceneSchema, storyFlagsSchema } from "./content-contracts.js";

const provenanceSchema = z.strictObject({
  creator: creditTextSchema.max(4000).optional(), source: creditTextSchema.max(4000).optional(),
  license: creditTextSchema.max(4000).optional(), credit: creditTextSchema.max(4000).optional(),
}).readonly();
export const artworkSchema = z.strictObject({
  id: identifierSchema, name: identifierSchema, kind: z.enum(["background", "cg", "character"]), url: artworkUrlSchema,
  compositing: z.enum(["alpha", "legacy-chroma-key", "opaque"]).optional(), prompt: textSchema.optional(),
  sceneId: sceneIdSchema.optional(), characterId: characterIdSchema.optional(), expression: characterIdSchema.optional(),
  createdAt: identifierSchema.optional(), provenance: provenanceSchema.optional(),
}).readonly();
export const scriptSchema = projectMetadataSchema.extend({
  nativeSaveId: z.string().regex(/^[a-f0-9]{16}(?:[a-f0-9]{16})?$/).optional(),
  characters: z.array(characterSchema).max(200).readonly(), scenes: z.array(sceneSchema).min(1).max(300).readonly(),
  flags: storyFlagsSchema.optional(), assets: z.array(artworkSchema).max(2000).readonly().optional(),
  audioAssets: z.array(z.strictObject({
    id: identifierSchema, name: identifierSchema, kind: z.enum(["bgm", "sfx", "voice"]), url: audioUrlSchema,
    duration: z.number().positive().max(1800), provenance: provenanceSchema.optional(),
  }).readonly()).max(5000).readonly().optional(), assetLibraryMode: z.enum(["project", "all"]).optional(),
}).transform((value, ctx) => {
  try { return parseScript(value); } catch (error) {
    if (!(error instanceof Error)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
    return z.NEVER;
  }
}).readonly();
