import type { z } from "zod";
import { HarnessError, parseDto, projectHeadSchema } from "./primitives.js";
import { canonicalBytes } from "./canonical.js";
import { budgetAdmissionSchema, budgetLimitsSchema, budgetRequestSchema, HARD_TRANSPORT_LIMITS } from "./budget-contracts.js";
import { createRunCommandSchema, runCommandSchema, reuseAnalysisCommandSchema } from "./command-contracts.js";
import { decisionReceiptSchema, effectSchema, proposalSchema, runSchema } from "./lifecycle-contracts.js";
import { previewSnapshotSchema, releaseSnapshotSchema } from "./snapshot-contracts.js";
import { productionDocumentSchema } from "./production-contracts.js";
import { reviewRecordSchema } from "./review-contracts.js";
import { reuseAnalysisSchema } from "./reuse-contracts.js";

export const parseProjectHead = (input: unknown) => parseDto(projectHeadSchema, input);
export const parseProductionDocument = (input: unknown) => parseDto(productionDocumentSchema, input);
export const parseProposal = (input: unknown) => parseDto(proposalSchema, input);
export const parseRun = (input: unknown) => parseDto(runSchema, input);
export const parseEffect = (input: unknown) => parseDto(effectSchema, input);
export const parseDecisionReceipt = (input: unknown) => parseDto(decisionReceiptSchema, input);
export const parseReviewRecord = (input: unknown) => parseDto(reviewRecordSchema, input);
export const parsePreviewSnapshot = (input: unknown) => parseDto(previewSnapshotSchema, input);
export const parseReleaseSnapshot = (input: unknown) => parseDto(releaseSnapshotSchema, input);
export const parseReuseAnalysis = (input: unknown) => parseDto(reuseAnalysisSchema, input);
export const parseBudgetLimits = (input: unknown) => parseDto(budgetLimitsSchema, input);
export const parseBudgetRequest = (input: unknown) => parseDto(budgetRequestSchema, input);
export const parseBudgetAdmission = (input: unknown) => parseDto(budgetAdmissionSchema, input);
export const parseRunCommand = (input: unknown) => parseDto(runCommandSchema, input);

function parseSnapshot<T>(schema: z.ZodType<T>, input: unknown): T {
  if (canonicalBytes(input).byteLength > HARD_TRANSPORT_LIMITS.snapshotBodyBytes) throw new HarnessError("LIMIT_EXCEEDED");
  return parseDto(schema, input);
}
export const parseCreateRunCommand = (input: unknown) => parseSnapshot(createRunCommandSchema, input);
export const parseReuseAnalysisCommand = (input: unknown) => parseSnapshot(reuseAnalysisCommandSchema, input);
/** HTTP adapters use this on the actual wire text, before whitespace or encoding overhead is lost. */
export function parseSnapshotJson<T>(schema: z.ZodType<T>, body: string): T {
  if (new TextEncoder().encode(body).byteLength > HARD_TRANSPORT_LIMITS.snapshotBodyBytes) throw new HarnessError("LIMIT_EXCEEDED");
  let input: unknown;
  try { input = JSON.parse(body); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HarnessError("INVALID_INPUT");
  }
  return parseDto(schema, input);
}
