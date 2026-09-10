import { z } from "zod";
import { assertNever } from "./primitives.js";
import { toolEnvelopeSchema } from "./tool-contracts.js";
import { reuseListPatchArtifactSchema, reuseListPatchPayloadSchema } from "./reuse-artifact-contracts.js";

/** Exact primary-owned narrow family: metadata only, no exit or sprite changes. */
export const reuseSceneMetadataEnvelopeSchema = toolEnvelopeSchema.transform((value, ctx) => {
  switch (value.tool) {
    case "set_scene":
      if (value.arguments.exit === undefined && !Object.hasOwn(value.arguments.patch.set, "sprites") &&
          !value.arguments.patch.unset.includes("sprites")) return value;
      break;
    case "project_overview": case "search_content": case "read_scene": case "read_canon":
    case "propose_canon": case "patch_project": case "patch_state": case "create_scene":
    case "delete_scene": case "patch_lines": case "patch_choices": case "upsert_character":
    case "request_art": case "validate_candidate": break;
    default: return assertNever(value);
  }
  ctx.addIssue({ code: "custom", message: "Expected no-exit non-sprite scene metadata" });
  return z.NEVER;
});
export const reuseSceneMetadataPayloadSchema = reuseListPatchPayloadSchema.unwrap()
  .omit({ kind: true, envelope: true }).extend({
    kind: z.literal("scene-metadata-patch"), envelope: reuseSceneMetadataEnvelopeSchema,
  }).refine(value => value.operationIds.length === 1).readonly();
export const reuseSceneMetadataArtifactSchema = reuseListPatchArtifactSchema;
export type ReuseSceneMetadataPayload = z.infer<typeof reuseSceneMetadataPayloadSchema>;
export type ReuseSceneMetadataArtifact = z.infer<typeof reuseSceneMetadataArtifactSchema>;
