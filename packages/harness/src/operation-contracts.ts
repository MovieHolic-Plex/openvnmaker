import { z } from "zod";
import { assertNever, choiceIdSchema, gapSchema, hashSchema, identifierSchema, lineIdSchema, sceneIdSchema, textSchema } from "./primitives.js";
import { choiceSetSchema, lineSetSchema, newChoiceSchema, newLineSchema, projectMetadataSchema, sceneMetadataSchema } from "./content-contracts.js";

export type FieldPatch<T> = { readonly set: Readonly<Partial<T>>; readonly unset: readonly (keyof T)[] };
/** The schema supplies the allowlist; only optional fields can be removed. */
function fieldPatch<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const optionalFields = new Set(Object.entries(schema.shape).filter(([, field]) => z.safeParse(field, undefined).success).map(([key]) => key));
  return z.strictObject({ set: schema.partial().readonly(), unset: z.array(schema.keyof()).readonly() })
    .superRefine((patch, ctx) => {
      for (const key of patch.unset) {
        if (Object.hasOwn(patch.set, key) || !optionalFields.has(key)) {
          ctx.addIssue({ code: "custom", path: ["unset"], message: "Required field or set/unset overlap" });
        }
      }
      if (new Set(patch.unset).size !== patch.unset.length) ctx.addIssue({ code: "custom", path: ["unset"], message: "Duplicate field" });
    }).readonly();
}
export const linePatchSchema = fieldPatch(lineSetSchema);
export const choicePatchSchema = fieldPatch(choiceSetSchema);
export const projectPatchSchema = fieldPatch(projectMetadataSchema);
export const scenePatchSchema = fieldPatch(sceneMetadataSchema);
export const newLineEntrySchema = z.strictObject({ clientKey: identifierSchema, value: newLineSchema }).readonly();
export const newChoiceEntrySchema = z.strictObject({ clientKey: identifierSchema, value: newChoiceSchema }).readonly();
export const lineOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("insert"), gap: gapSchema, lines: z.array(newLineEntrySchema).min(1).max(100).readonly() }),
  z.strictObject({ kind: z.literal("update"), lineId: lineIdSchema, expectedEntityHash: hashSchema, patch: linePatchSchema }),
  z.strictObject({ kind: z.literal("delete"), lineId: lineIdSchema, expectedEntityHash: hashSchema }),
  z.strictObject({ kind: z.literal("move"), lineId: lineIdSchema, expectedEntityHash: hashSchema, gap: gapSchema }),
]).readonly();
export const choiceOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("insert"), gap: gapSchema, choices: z.array(newChoiceEntrySchema).min(1).max(8).readonly() }),
  z.strictObject({ kind: z.literal("update"), choiceId: choiceIdSchema, expectedEntityHash: hashSchema, patch: choicePatchSchema }),
  z.strictObject({ kind: z.literal("delete"), choiceId: choiceIdSchema, expectedEntityHash: hashSchema }),
  z.strictObject({ kind: z.literal("move"), choiceId: choiceIdSchema, expectedEntityHash: hashSchema, gap: gapSchema }),
]).readonly();
export const choiceEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("existing"), choiceId: choiceIdSchema, expectedEntityHash: hashSchema }),
  z.strictObject({ kind: z.literal("new"), clientKey: identifierSchema, value: newChoiceSchema }),
]).readonly();
export const sceneExitSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("next"), sceneId: sceneIdSchema }),
  z.strictObject({ kind: z.literal("choices"), choices: z.array(choiceEntrySchema).min(1).max(8).readonly() }),
  z.strictObject({ kind: z.literal("ending"), title: textSchema }),
  z.strictObject({ kind: z.literal("planned"), sceneId: sceneIdSchema }),
]).readonly();
export type LineOperation = z.infer<typeof lineOperationSchema>;
export type ChoiceOperation = z.infer<typeof choiceOperationSchema>;
function mutationCount(operation: LineOperation | ChoiceOperation): number {
  switch (operation.kind) {
    case "insert": return "lines" in operation ? operation.lines.length : operation.choices.length;
    case "update": case "delete": case "move": return 1;
    default: return assertNever(operation);
  }
}
export const lineOperationsSchema = z.array(lineOperationSchema).min(1).max(100).refine(operations =>
  operations.reduce((count, operation) => count + mutationCount(operation), 0) <= 100).readonly();
export const choiceOperationsSchema = z.array(choiceOperationSchema).min(1).max(100).refine(operations =>
  operations.reduce((count, operation) => count + mutationCount(operation), 0) <= 100).readonly();
export type SceneExit = z.infer<typeof sceneExitSchema>;
export type ChoiceEntry = z.infer<typeof choiceEntrySchema>;
