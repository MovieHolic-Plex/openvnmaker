import { z } from "zod";
import { assertNever, characterIdSchema, hashSchema, identifierSchema, lineIdSchema, sceneIdSchema, textSchema } from "./primitives.js";
import { choiceSchema, lineConditionSchema, storyFlagsSchema } from "./content-contracts.js";

export const artRoleSchema = z.enum(["reference", "expression", "pose", "background", "cg"]);
export const characterArtTargetSchema = z.strictObject({ kind: z.literal("character"), characterId: characterIdSchema, expression: characterIdSchema.optional() });
export const sceneArtTargetSchema = z.strictObject({ kind: z.literal("scene"), sceneId: sceneIdSchema, lineId: lineIdSchema.optional(), slot: z.enum(["background", "cg"]) });
export const artTargetSchema = z.discriminatedUnion("kind", [characterArtTargetSchema, sceneArtTargetSchema]).readonly();
export const approvedArtBindingSchema = z.strictObject({
  assetId: identifierSchema, originalHash: hashSchema, deliveryHash: hashSchema,
  referenceVersionIds: z.array(identifierSchema).readonly(), role: artRoleSchema, target: artTargetSchema,
}).refine(binding => artTargetMatchesRole(binding.role, binding.target)).readonly();
export function artTargetMatchesRole(role: z.infer<typeof artRoleSchema>, target: z.infer<typeof artTargetSchema>): boolean {
  switch (role) {
    case "reference": case "expression": case "pose": return target.kind === "character";
    case "background": return target.kind === "scene" && target.slot === "background";
    case "cg": return target.kind === "scene" && target.slot === "cg";
    default: return assertNever(role);
  }
}
export const endingOutcomeSchema = z.strictObject({
  endingId: sceneIdSchema, requiredRouteState: storyFlagsSchema, resolution: textSchema, cost: textSchema,
  relationshipChanges: z.array(textSchema).readonly(), openThreads: z.array(textSchema).readonly(),
}).readonly();
export const productionOutlineSchema = z.strictObject({
  title: identifierSchema, subtitle: textSchema, bible: textSchema, start: sceneIdSchema,
  scenes: z.array(z.strictObject({
    id: sceneIdSchema, chapter: textSchema, title: textSchema, summary: textSchema, artDirection: textSchema,
    targetMinutes: z.number().positive(), background: identifierSchema,
    next: sceneIdSchema.optional(), choices: z.array(choiceSchema).max(8).readonly().optional(), ending: textSchema.optional(),
  }).readonly()).max(300).readonly(), endingOutcomes: z.array(endingOutcomeSchema).readonly().optional(),
}).readonly();
export const canonEntrySchema = z.strictObject({
  id: identifierSchema,
  category: z.enum(["voice", "motivation", "world-fact", "timeline-event", "branch-fact", "foreshadow", "payoff", "visual-rule"]),
  text: z.string().max(2000), characterIds: z.array(characterIdSchema).readonly(), sceneIds: z.array(sceneIdSchema).readonly(),
  relatedEntryIds: z.array(identifierSchema).readonly(),
  applicability: z.strictObject({ anyOf: z.array(lineConditionSchema).min(1).max(16).readonly() }).readonly().optional(),
  truth: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("world"), holderCharacterId: characterIdSchema.optional() }),
    z.strictObject({ kind: z.literal("belief"), holderCharacterId: characterIdSchema }),
    z.strictObject({ kind: z.literal("rumour"), holderCharacterId: characterIdSchema.optional() }),
  ]).readonly().optional(),
}).readonly();
export const canonSectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entries"), entries: z.array(canonEntrySchema).max(100).readonly() }),
  z.strictObject({ kind: z.literal("outline"), outline: productionOutlineSchema }),
  z.strictObject({ kind: z.literal("art-direction"), rules: z.array(canonEntrySchema).max(100).readonly() }),
]).readonly();
export const productionDocumentSchema = z.strictObject({
  version: z.literal(1), brief: textSchema, castCanon: z.array(canonEntrySchema).readonly(),
  worldTimeline: z.array(canonEntrySchema).readonly(), branchFacts: z.array(canonEntrySchema).readonly(),
  outline: productionOutlineSchema, artDirection: z.array(canonEntrySchema).readonly(),
  referenceBindings: z.array(approvedArtBindingSchema).readonly(),
}).readonly();
export type ArtTarget = z.infer<typeof artTargetSchema>;
export type ApprovedArtBinding = z.infer<typeof approvedArtBindingSchema>;
export type ProductionOutline = z.infer<typeof productionOutlineSchema>;
export type CanonEntry = z.infer<typeof canonEntrySchema>;
export type CanonSection = z.infer<typeof canonSectionSchema>;
export type ProductionDocument = z.infer<typeof productionDocumentSchema>;
