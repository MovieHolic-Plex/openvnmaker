import { z } from "zod";
import { BACKGROUNDS, BGM, SFX, validAudioUrl, validBackgroundUrl } from "@vnmaker/content";
import { choiceEffectsCompatible, uniqueDefinedIdentities } from "./boundary-refinements.js";
import { characterIdSchema, choiceIdSchema, identifierSchema, lineIdSchema, sceneIdSchema, textSchema } from "./primitives.js";

export const flagIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/i)
  .refine(value => !["constructor", "prototype", "__proto__"].includes(value));
export const flagValueSchema = z.union([z.string().max(200), z.number(), z.boolean()]);
export const storyFlagsSchema = z.record(flagIdSchema, flagValueSchema)
  .refine(value => Object.keys(value).length <= 100).readonly();
export const lineConditionSchema = z.strictObject({
  all: z.array(flagIdSchema).max(100).readonly().optional(),
  none: z.array(flagIdSchema).max(100).readonly().optional(),
  compare: z.array(z.union([
    z.strictObject({ flag: flagIdSchema, op: z.enum(["eq", "ne"]), value: flagValueSchema }).readonly(),
    z.strictObject({ flag: flagIdSchema, op: z.enum(["gt", "gte", "lt", "lte"]), value: z.number() }).readonly(),
  ])).max(100).readonly().optional(),
}).readonly();
export const artworkUrlSchema = z.string().refine(validBackgroundUrl);
export const audioUrlSchema = z.string().refine(validAudioUrl);
const bgmSchema = z.string().refine(value => Object.hasOwn(BGM, value) || validAudioUrl(value));
const sfxSchema = z.string().refine(value => Object.hasOwn(SFX, value) || validAudioUrl(value));
export const spriteDirectionSchema = z.strictObject({
  slot: z.enum(["left", "center", "right"]), character: characterIdSchema.nullable(),
  expression: characterIdSchema.optional(), poseUrl: artworkUrlSchema.nullable().optional(),
}).readonly();
const spritesSchema = z.array(spriteDirectionSchema).max(3)
  .refine(rows => new Set(rows.map(row => row.slot)).size === rows.length).readonly();
const framingSchema = z.enum(["wide", "close", "cinematic"]);
export const lineSetSchema = z.strictObject({
  speaker: characterIdSchema.nullable(), text: textSchema, expression: characterIdSchema.optional(),
  sfx: sfxSchema.optional(), voice: audioUrlSchema.optional(), shake: z.boolean().optional(),
  cgHide: z.boolean().optional(), cgUrl: artworkUrlSchema.nullable().optional(),
  backgroundUrl: artworkUrlSchema.optional(), when: lineConditionSchema.optional(),
  sprites: spritesSchema.optional(), framing: framingSchema.optional(), bgm: bgmSchema.nullable().optional(),
});
export const newLineSchema = lineSetSchema.readonly();
export const lineSchema = lineSetSchema.extend({ id: lineIdSchema.optional() }).readonly();
export const choiceSetSchema = z.strictObject({
  text: textSchema, next: sceneIdSchema, when: lineConditionSchema.optional(),
  set: storyFlagsSchema.optional(), add: z.record(flagIdSchema, z.number()).readonly().optional(),
  disable: z.boolean().optional(), affection: z.number().optional(),
});
export const newChoiceSchema = choiceSetSchema.refine(choiceEffectsCompatible).readonly();
export const choiceSchema = choiceSetSchema.extend({ id: choiceIdSchema.optional(), cond: z.literal("").optional() })
  .refine(choiceEffectsCompatible).readonly();
export const sceneMetadataSchema = z.strictObject({
  chapter: textSchema.optional(), background: z.string().refine(value => Object.hasOwn(BACKGROUNDS, value)),
  backgroundUrl: artworkUrlSchema.optional(), cgUrl: artworkUrlSchema.optional(), hideSprites: z.boolean().optional(),
  framing: framingSchema.optional(), artBrief: textSchema.optional(), bgm: bgmSchema.optional(),
  cg: identifierSchema.optional(), transition: z.enum(["none", "fade", "dissolve", "flash", "fadeToBlack"]).optional(),
  sprites: spritesSchema.optional(),
});
export const sceneSchema = sceneMetadataSchema.extend({
  id: sceneIdSchema, lines: z.array(lineSchema).min(1).max(2000)
    .refine(lines => uniqueDefinedIdentities(lines.map(line => line.id))).readonly(),
  choices: z.array(choiceSchema).max(8)
    .refine(choices => uniqueDefinedIdentities(choices.map(choice => choice.id))).readonly().optional(),
  next: sceneIdSchema.optional(), ending: textSchema.optional(),
}).readonly();
export const characterSchema = z.strictObject({
  id: characterIdSchema, name: identifierSchema, color: z.string().regex(/^#[a-f0-9]{6}$/i), bio: textSchema,
  outfits: z.array(identifierSchema).optional(),
  expressionImages: z.record(characterIdSchema, artworkUrlSchema).readonly().optional(),
  chromaKey: z.literal("#00ff00").optional(),
}).readonly();
export const creditTextSchema = z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
export const projectMetadataSchema = z.strictObject({
  title: identifierSchema, subtitle: textSchema, start: sceneIdSchema, artDirection: textSchema.optional(),
  musicFadeSeconds: z.number().min(0).max(10).optional(),
  credits: z.array(z.strictObject({ role: creditTextSchema.max(120), names: creditTextSchema.max(4000) }).readonly()).max(100).readonly().optional(),
});
export type NewLine = z.infer<typeof newLineSchema>;
export type NewChoice = z.infer<typeof newChoiceSchema>;
export type SceneMetadata = Readonly<z.infer<typeof sceneMetadataSchema>>;
export type ProjectMetadata = Readonly<z.infer<typeof projectMetadataSchema>>;
