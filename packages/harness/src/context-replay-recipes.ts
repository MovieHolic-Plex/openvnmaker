import { z } from "zod";
import { lineIdSchema, sceneIdSchema } from "./primitives.js";
import { toolArgumentsSchemas } from "./tool-contracts.js";

const structuredRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("scene-metadata"), version: z.literal(1),
    sceneId: sceneIdSchema,
  }),
  z.strictObject({
    kind: z.literal("scene-window"), version: z.literal(1),
    sceneId: sceneIdSchema, afterLineId: lineIdSchema.optional(),
    limit: z.number().int().min(1).max(100),
  }),
  z.strictObject({ kind: z.literal("script-start"), version: z.literal(1) }),
  z.strictObject({ kind: z.literal("initial-state") }),
  z.strictObject({ kind: z.literal("predecessor-scenes"), sceneId: sceneIdSchema }),
  z.strictObject({
    kind: z.literal("reference-bindings"), sceneId: sceneIdSchema,
    lineIds: z.array(lineIdSchema).max(100).readonly(),
  }),
]).readonly();

const searchRecipeSchema = toolArgumentsSchemas.search_content
  .omit({ cursor: true, limit: true })
  .transform(value => ({ ...value, kind: "search" as const }))
  .readonly();

export type ContextRecipe =
  | z.infer<typeof structuredRecipeSchema>
  | z.infer<typeof searchRecipeSchema>;

export type ContextRecipeParse =
  | { readonly kind: "parsed"; readonly recipe: ContextRecipe }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "unsupported"; readonly reason: string };

const headerSchema = z.object({
  kind: z.string().optional(),
  version: z.unknown().optional(),
});

export function parseContextRecipe(text: string): ContextRecipeParse {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { kind: "blocked", reason: "INVALID_RECIPE" };
  }
  const header = headerSchema.safeParse(input);
  if (!header.success) return { kind: "blocked", reason: "INVALID_RECIPE" };
  if (header.data.kind === undefined) {
    const search = searchRecipeSchema.safeParse(input);
    return search.success
      ? { kind: "parsed", recipe: search.data }
      : { kind: "blocked", reason: "INVALID_RECIPE" };
  }
  const parsed = structuredRecipeSchema.safeParse(input);
  if (parsed.success) return { kind: "parsed", recipe: parsed.data };
  switch (header.data.kind) {
    case "scene-metadata": case "scene-window": case "script-start":
      if (header.data.version !== undefined && header.data.version !== 1) {
        return { kind: "unsupported", reason: "UNSUPPORTED_RECIPE_VERSION" };
      }
      return { kind: "blocked", reason: "INVALID_RECIPE" };
    case "initial-state": case "predecessor-scenes": case "reference-bindings":
      return header.data.version === undefined
        ? { kind: "blocked", reason: "INVALID_RECIPE" }
        : { kind: "unsupported", reason: "UNSUPPORTED_RECIPE_VERSION" };
    default:
      return { kind: "unsupported", reason: "UNKNOWN_RECIPE" };
  }
}
