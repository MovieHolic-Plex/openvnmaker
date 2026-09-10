import { canonicalHash } from "./canonical.js";
import { prepareAllocations } from "./operations-allocation.js";
import type { OperationJournal } from "./operations-receipts.js";
import { isWriteSetAuthorized, requiredWriteSet } from "./operations-scope.js";
import type { CandidateToolInput, CandidateToolOutcome } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { HarnessErrorCode } from "./primitives.js";

export async function applyJournaledTool(
  input: CandidateToolInput,
  execute: (input: CandidateToolInput) => Promise<CandidateToolOutcome>,
): Promise<CandidateToolOutcome> {
  function failure(code: HarnessErrorCode): CandidateToolOutcome {
    return {
      candidate: input.candidate, journal: input.journal,
      result: {
        ok: false, callId: input.envelope.callId, code, message: code,
        currentCandidateRef: input.candidate.ref, retryHint: [],
      },
    };
  }
  if (input.journal.candidateId !== input.candidate.ref.candidateId ||
      input.envelope.candidateId !== input.candidate.ref.candidateId) {
    return failure("STALE_HEAD");
  }
  const required = requiredWriteSet(input.envelope);
  if (!isWriteSetAuthorized(required, input.authorizedWriteSet)) {
    return failure("WRITE_SCOPE_DENIED");
  }
  const payloadHash = await canonicalHash({ unitId: input.unitId, envelope: input.envelope });
  const receipt = input.journal.calls.find(call => call.result.callId === input.envelope.callId);
  if (receipt) {
    if (!isWriteSetAuthorized(receipt.requiredWriteSet, input.authorizedWriteSet)) {
      return failure("WRITE_SCOPE_DENIED");
    }
    if (receipt.unitId !== input.unitId || receipt.payloadHash !== payloadHash) {
      return failure("ID_PAYLOAD_CONFLICT");
    }
    return { candidate: input.candidate, journal: input.journal, result: receipt.result };
  }

  function record(
    outcome: CandidateToolOutcome,
    allocations: OperationJournal["allocations"],
  ): CandidateToolOutcome {
    return {
      ...outcome,
      journal: {
        candidateId: input.journal.candidateId,
        calls: [...input.journal.calls, {
          unitId: input.unitId, payloadHash, requiredWriteSet: required,
          result: outcome.result,
        }],
        allocations,
      },
    };
  }
  if (input.envelope.expectedCandidateRevision !== input.candidate.ref.revision) {
    return record(failure("STALE_HEAD"), input.journal.allocations);
  }
  const prepared = await prepareAllocations(input);
  switch (prepared.ok) {
    case false:
      return record(failure(prepared.code), input.journal.allocations);
    case true: break;
    default: return assertNever(prepared);
  }
  const outcome = await execute(input);
  switch (outcome.result.ok) {
    case false: return record(outcome, input.journal.allocations);
    case true: return record(outcome, prepared.allocations);
    default: return assertNever(outcome.result);
  }
}
