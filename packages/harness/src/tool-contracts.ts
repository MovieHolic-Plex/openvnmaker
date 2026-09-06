import { z } from "zod";
import { candidateIdSchema, characterIdSchema, hashSchema, HarnessError, identifierSchema, lineIdSchema, positiveIntegerSchema, revisionSchema, sceneIdSchema, textSchema, uuidSchema } from "./primitives.js";
import { characterSchema, flagIdSchema, flagValueSchema, sceneMetadataSchema } from "./content-contracts.js";
import { artRoleSchema, artTargetMatchesRole, artTargetSchema, canonSectionSchema } from "./production-contracts.js";
import { choiceOperationsSchema, lineOperationsSchema, newLineEntrySchema, projectPatchSchema, sceneExitSchema, scenePatchSchema } from "./operation-contracts.js";

const stateArguments = z.strictObject({
  expectedStateHash: hashSchema,
  declare: z.array(z.strictObject({ id: flagIdSchema, value: flagValueSchema }).readonly()).max(100).readonly(),
  setInitial: z.array(z.strictObject({ id: flagIdSchema, expectedValue: flagValueSchema, value: flagValueSchema }).readonly()).max(100).readonly(),
  remove: z.array(z.strictObject({ id: flagIdSchema, expectedValue: flagValueSchema }).readonly()).max(100).readonly(),
}).refine(value => {
  const ids = [...value.declare, ...value.setInitial, ...value.remove].map(row => row.id);
  return new Set(ids).size === ids.length;
});
export const toolArgumentsSchemas = {
  project_overview: z.strictObject({ cursor: identifierSchema.optional(), limit: positiveIntegerSchema.max(40).optional() }),
  search_content: z.strictObject({ query: z.string().min(1).max(500), kinds: z.array(z.enum(["line", "choice", "canon"])).min(1).max(3).readonly(), sceneId: sceneIdSchema.optional(), cursor: identifierSchema.optional(), limit: positiveIntegerSchema.max(40).optional() }),
  read_scene: z.strictObject({ sceneId: sceneIdSchema, afterLineId: lineIdSchema.optional(), limit: positiveIntegerSchema.max(100).optional() }),
  read_canon: z.strictObject({ sectionIds: z.array(identifierSchema).min(1).max(100).readonly(), factIds: z.array(identifierSchema).max(100).readonly().optional() }),
  propose_canon: z.strictObject({ sectionId: identifierSchema, expectedSectionHash: hashSchema, replacement: canonSectionSchema, reason: textSchema }),
  patch_project: z.strictObject({ expectedMetadataHash: hashSchema, patch: projectPatchSchema }),
  patch_state: stateArguments,
  create_scene: z.strictObject({ sceneId: sceneIdSchema, planBeatId: identifierSchema, metadata: sceneMetadataSchema.readonly(), lines: z.array(newLineEntrySchema).min(1).max(100).readonly(), exit: sceneExitSchema }),
  delete_scene: z.strictObject({ sceneId: sceneIdSchema, expectedSceneHash: hashSchema }),
  patch_lines: z.strictObject({ sceneId: sceneIdSchema, operations: lineOperationsSchema }),
  patch_choices: z.strictObject({ sceneId: sceneIdSchema, operations: choiceOperationsSchema }),
  set_scene: z.strictObject({ sceneId: sceneIdSchema, expectedSceneHash: hashSchema, patch: scenePatchSchema, exit: sceneExitSchema.optional() }),
  upsert_character: z.strictObject({ characterId: characterIdSchema, expectedCharacterHash: hashSchema.nullable(), value: characterSchema }).refine(row => row.characterId === row.value.id),
  request_art: z.strictObject({ assetRequestId: identifierSchema, kind: artRoleSchema, target: artTargetSchema, referenceBindingIds: z.array(identifierSchema).readonly(), brief: textSchema }).refine(row => artTargetMatchesRole(row.kind, row.target)),
  validate_candidate: z.strictObject({ sceneIds: z.array(sceneIdSchema).readonly().optional(), mode: z.enum(["local", "proposal"]) }),
} as const;
export const toolNameSchema = z.enum([
  "project_overview", "search_content", "read_scene", "read_canon", "propose_canon", "patch_project", "patch_state",
  "create_scene", "delete_scene", "patch_lines", "patch_choices", "set_scene", "upsert_character", "request_art", "validate_candidate",
]);
function envelope<K extends keyof typeof toolArgumentsSchemas>(tool: K) {
  return z.strictObject({ callId: uuidSchema, candidateId: candidateIdSchema, expectedCandidateRevision: revisionSchema,
    tool: z.literal(tool), arguments: z.readonly(toolArgumentsSchemas[tool]) });
}
export const toolEnvelopeSchema = z.discriminatedUnion("tool", [
  envelope("project_overview"), envelope("search_content"), envelope("read_scene"), envelope("read_canon"),
  envelope("propose_canon"), envelope("patch_project"), envelope("patch_state"), envelope("create_scene"),
  envelope("delete_scene"), envelope("patch_lines"), envelope("patch_choices"), envelope("set_scene"),
  envelope("upsert_character"), envelope("request_art"), envelope("validate_candidate"),
]).readonly();
export type ToolEnvelope = z.infer<typeof toolEnvelopeSchema>;
export type ToolName = ToolEnvelope["tool"];
export type ToolArguments = ToolEnvelope["arguments"];
export function parseToolEnvelope(input: unknown): ToolEnvelope {
  const result = toolEnvelopeSchema.safeParse(input);
  if (!result.success) {
    const named = z.object({ tool: z.string() }).safeParse(input);
    const code = named.success && !Object.hasOwn(toolArgumentsSchemas, named.data.tool) ? "UNKNOWN_TOOL" : "INVALID_OPERATION";
    throw new HarnessError(code, result.error.issues);
  }
  return result.data;
}
