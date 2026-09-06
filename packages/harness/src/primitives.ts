import { z } from "zod";
import { validCharacterKey } from "@vnmaker/content";

export const textSchema = z.string().max(20_000);
export const identifierSchema = textSchema.refine(value => value.trim().length > 0);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"Sha256">();
export const uuidSchema = z.uuid();
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).brand<"Revision">();
export const counterSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const positiveIntegerSchema = counterSchema.min(1);
export const bytesSchema = counterSchema.brand<"Bytes">();
export const tokensSchema = counterSchema.brand<"Tokens">();
export const sceneIdSchema = identifierSchema.brand<"SceneId">();
export const narrativeIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
export const lineIdSchema = narrativeIdSchema.brand<"LineId">();
export const choiceIdSchema = narrativeIdSchema.brand<"ChoiceId">();
export const characterIdSchema = z.string().refine(validCharacterKey).brand<"CharacterId">();
export const projectIdSchema = identifierSchema.brand<"ProjectId">();
export const lineageIdSchema = uuidSchema.brand<"LineageId">();
export const runIdSchema = uuidSchema.brand<"RunId">();
export const candidateIdSchema = uuidSchema.brand<"CandidateId">();
export const unitIdSchema = uuidSchema.brand<"UnitId">();
export const timestampSchema = z.iso.datetime({ offset: true });
export const projectHeadSchema = z.strictObject({
  projectId: projectIdSchema, lineageId: lineageIdSchema, revision: revisionSchema,
  scriptHash: hashSchema, productionHash: hashSchema,
}).readonly();
export const candidateRefSchema = z.strictObject({ candidateId: candidateIdSchema, revision: revisionSchema }).readonly();
export const entityPreconditionSchema = z.strictObject({
  sceneId: sceneIdSchema, entityId: narrativeIdSchema, expectedEntityHash: hashSchema,
}).readonly();
export const gapSchema = z.strictObject({ leftId: narrativeIdSchema.nullable(), rightId: narrativeIdSchema.nullable() })
  .refine(gap => gap.leftId === null || gap.leftId !== gap.rightId).readonly();
export type Sha256 = z.infer<typeof hashSchema>;
export type Bytes = z.infer<typeof bytesSchema>;
export type Tokens = z.infer<typeof tokensSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type LineageId = z.infer<typeof lineageIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type CandidateId = z.infer<typeof candidateIdSchema>;
export type UnitId = z.infer<typeof unitIdSchema>;
export type SceneId = z.infer<typeof sceneIdSchema>;
export type LineId = z.infer<typeof lineIdSchema>;
export type ChoiceId = z.infer<typeof choiceIdSchema>;
export type CharacterId = z.infer<typeof characterIdSchema>;
export type ProjectHead = z.infer<typeof projectHeadSchema>;
export type CandidateRef = z.infer<typeof candidateRefSchema>;
export type EntityPrecondition = z.infer<typeof entityPreconditionSchema>;
export type Gap = z.infer<typeof gapSchema>;

export const errorCodeSchema = z.enum([
  "INVALID_OPERATION", "INVALID_INPUT", "UNKNOWN_TOOL", "ID_PAYLOAD_CONFLICT", "STALE_GAP", "STALE_TARGET",
  "STALE_HEAD", "STALE_REVIEW", "REFERENCED_ENTITY", "WRITE_SCOPE_DENIED", "REVIEW_REQUIRED",
  "REPROPOSE_REQUIRED", "UNKNOWN_EFFECT", "INVALID_STATE", "DECISION_CONFLICT", "PREVIEW_NOT_RELEASE",
  "AUTH_REQUIRED", "CAPABILITY_REQUIRED", "ORIGIN_DENIED", "LIMIT_EXCEEDED", "QUOTA", "UPSTREAM",
  "RUNNER_UNAVAILABLE", "CONTEXT_LIMIT", "INVALID_CANONICAL_VALUE",
]);
export type HarnessErrorCode = z.infer<typeof errorCodeSchema>;
export class HarnessError extends Error {
  override readonly name = "HarnessError";
  constructor(readonly code: HarnessErrorCode, readonly details: readonly z.core.$ZodIssue[] = []) {
    super(code);
  }
}
export function parseDto<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HarnessError("INVALID_INPUT", result.error.issues);
  return result.data;
}
export function assertNever(value: never): never {
  throw new HarnessError("INVALID_INPUT", [{ code: "custom", path: [], message: String(value) }]);
}
