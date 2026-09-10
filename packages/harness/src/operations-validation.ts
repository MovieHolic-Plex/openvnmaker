import { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type { ReadSet } from "./context-contracts.js";
import type { CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { assertNever, sceneIdSchema } from "./primitives.js";
import type { CandidateRef, SceneId, Sha256 } from "./primitives.js";
import type { ValidationReport } from "./review-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

export type CandidateValidationScope = {
  readonly mode: "local" | "proposal";
  readonly sceneIds: readonly SceneId[];
};

/** Evidence produced by the validation service, never by tool arguments. */
export type PreparedCandidateValidation = {
  readonly candidateRef: CandidateRef;
  readonly candidateDigest: Sha256;
  readonly scope: CandidateValidationScope;
  readonly report: ValidationReport;
  readonly readSet: ReadSet;
};

type ValidationOperationInput = CandidateToolInput & {
  readonly preparedValidation: PreparedCandidateValidation;
  readonly envelope: Extract<ToolEnvelope, { readonly tool: "validate_candidate" }>;
};

export async function applyValidationOperation(
  input: ValidationOperationInput,
): Promise<ScriptMutationResult> {
  const { candidate, envelope, preparedValidation } = input;
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }
  if (preparedValidation.candidateRef.candidateId !== candidate.ref.candidateId ||
      preparedValidation.candidateRef.revision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_REVIEW" };
  }
  const candidateDigest = await canonicalHash({
    script: candidate.script, productionDocument: candidate.productionDocument,
  });
  if (candidateDigest !== preparedValidation.candidateDigest) {
    return { ok: false, code: "STALE_REVIEW" };
  }
  const actual = candidate.script.scenes.map(scene => sceneIdSchema.parse(scene.id));
  let selected: readonly SceneId[];
  switch (envelope.arguments.mode) {
    case "local":
      selected = envelope.arguments.sceneIds ?? actual;
      break;
    case "proposal":
      selected = actual;
      break;
    default: return assertNever(envelope.arguments.mode);
  }
  if (selected.some(id => !actual.includes(id))) {
    return { ok: false, code: "STALE_TARGET" };
  }
  const scope: CandidateValidationScope = {
    mode: envelope.arguments.mode,
    sceneIds: [...new Set(selected)].sort(),
  };
  if (canonicalJson(scope) !== canonicalJson(preparedValidation.scope)) {
    return { ok: false, code: "INVALID_OPERATION" };
  }
  const serialized: unknown = JSON.parse(canonicalJson({
    kind: "candidate-validation",
    candidateRef: preparedValidation.candidateRef,
    candidateDigest,
    scope,
    report: preparedValidation.report,
  }));
  return {
    ok: true,
    mutation: {
      script: candidate.script,
      data: z.json().parse(serialized),
      readSet: preparedValidation.readSet,
      writeSet: [],
    },
  };
}
