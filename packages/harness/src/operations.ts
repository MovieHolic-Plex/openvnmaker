import { canonicalJson } from "./canonical.js";
import type { ReadSet, WriteSet } from "./context-contracts.js";
import type { ToolResult } from "./lifecycle-contracts.js";
import type { PreparedArtIntent } from "./operations-art.js";
import type { PreparedCandidateValidation } from "./operations-validation.js";
import { applyValidationOperation } from "./operations-validation.js";
import { acknowledgeArtIntent } from "./operations-art.js";
import type { OperationJournal } from "./operations-receipts.js";
import { applyJournaledTool } from "./operations-journal.js";
import { proposeCanonOperation } from "./operations-canon.js";
import { applyCharacterOperation } from "./operations-character.js";
import { applyListOperations } from "./operations-list.js";
import { isWriteSetAuthorized, requiredWriteSet } from "./operations-scope.js";
import { applyProjectOperation } from "./operations-project.js";
import { applyReadOperation } from "./operations-read.js";
import { applyInspectOperation } from "./operations-inspect.js";
import { applySceneOperation } from "./operations-scene.js";
import { applyStateOperation } from "./operations-state.js";
import { hasRegisteredChoiceDestinations } from "./operations-targets.js";
import { assertNever, revisionSchema } from "./primitives.js";
import type { CandidateRef, HarnessErrorCode, ProjectHead, UnitId } from "./primitives.js";
import type { ProductionDocument } from "./production-contracts.js";
import { scriptSchema } from "./script-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

export type Candidate = {
  readonly ref: CandidateRef;
  readonly script: ReturnType<typeof scriptSchema.parse>;
  readonly productionDocument: ProductionDocument;
};

export type CandidateToolInput = {
  /** Immutable run origin supplied by the repository, never by tool arguments. */
  readonly sourceHead?: ProjectHead;
  readonly preparedArt?: PreparedArtIntent;
  readonly preparedValidation?: PreparedCandidateValidation;
  readonly journal: OperationJournal;
  readonly unitId: UnitId;
  readonly candidate: Candidate;
  readonly envelope: ToolEnvelope;
  readonly authorizedWriteSet: WriteSet;
};

export type CandidateToolOutcome = {
  readonly journal: OperationJournal;
  readonly candidate: Candidate;
  readonly result: ToolResult;
};

export type ScriptMutation = {
  readonly script: Candidate["script"];
  readonly data: Extract<ToolResult, { readonly ok: true }>["data"];
  readonly readSet: ReadSet;
  readonly writeSet: WriteSet;
};

export type ScriptMutationResult =
  | { readonly ok: true; readonly mutation: ScriptMutation }
  | { readonly ok: false; readonly code: HarnessErrorCode };

export async function applyCandidateTool(
  input: CandidateToolInput,
): Promise<CandidateToolOutcome> {
  return applyJournaledTool(input, executeCandidateTool);
}

async function executeCandidateTool(
  input: CandidateToolInput,
): Promise<CandidateToolOutcome> {
  const { candidate, envelope, authorizedWriteSet } = input;
  function reject(
    code: HarnessErrorCode,
    message: string = code,
  ): CandidateToolOutcome {
    return {
      journal: input.journal,
      candidate,
      result: {
        ok: false, callId: envelope.callId, code, message,
        currentCandidateRef: candidate.ref, retryHint: [],
      },
    };
  }

  function publish(mutation: ScriptMutation): CandidateToolOutcome {
    const changed = canonicalJson(mutation.script) !== canonicalJson(candidate.script);
    const revision = revisionSchema.safeParse(
      candidate.ref.revision + (changed ? 1 : 0),
    );
    if (!revision.success) return reject("LIMIT_EXCEEDED");
    const next = changed ? {
      ...candidate,
      ref: { ...candidate.ref, revision: revision.data },
      script: mutation.script,
    } : candidate;
    return {
      journal: input.journal,
      candidate: next,
      result: {
        ok: true, callId: envelope.callId, candidateRef: next.ref,
        changed, data: mutation.data, readSet: mutation.readSet,
        writeSet: changed ? mutation.writeSet : [],
      },
    };
  }

  switch (envelope.tool) {
    case "patch_lines": case "patch_choices": {
      const { sceneId } = envelope.arguments;
      const required = requiredWriteSet(envelope);
      if (!isWriteSetAuthorized(required, authorizedWriteSet)) {
        return reject("WRITE_SCOPE_DENIED");
      }
      if (envelope.candidateId !== candidate.ref.candidateId ||
          envelope.expectedCandidateRevision !== candidate.ref.revision) {
        return reject("STALE_HEAD");
      }
      const scene = candidate.script.scenes.find(row => row.id === sceneId);
      if (!scene) return reject("STALE_TARGET");

      const mutation = await applyListOperations({
        envelope, scene, unitId: input.unitId,
        candidateId: candidate.ref.candidateId,
      });
      switch (mutation.ok) {
        case false: return reject(mutation.code);
        case true: break;
        default: return assertNever(mutation);
      }

      switch (envelope.tool) {
        case "patch_lines": break;
        case "patch_choices": {
          if (!hasRegisteredChoiceDestinations(candidate, mutation.scene)) {
            return reject("INVALID_OPERATION");
          }
          break;
        }
        default: return assertNever(envelope);
      }

      const parsed = scriptSchema.safeParse({
        ...candidate.script,
        scenes: candidate.script.scenes.map(row =>
          row.id === sceneId ? mutation.scene : row),
      });
      if (!parsed.success) return reject("INVALID_OPERATION");
      return publish({
        script: parsed.data, data: mutation.data,
        readSet: mutation.readSet,
        writeSet: required,
      });
    }
    case "patch_project": {
      const result = await applyProjectOperation({ ...input, envelope });
      switch (result.ok) {
        case false: return reject(result.code);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "patch_state": {
      const result = await applyStateOperation({ ...input, envelope });
      switch (result.ok) {
        case false: return reject(result.code);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "create_scene": case "delete_scene": case "set_scene": {
      const result = await applySceneOperation({ ...input, envelope });
      switch (result.ok) {
        case false: return reject(result.code);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "upsert_character": {
      const result = await applyCharacterOperation({ ...input, envelope });
      switch (result.ok) {
        case false: return reject(result.code);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "propose_canon": {
      const result = await proposeCanonOperation({ ...input, envelope });
      switch (result.ok) {
        case false: return reject(result.code);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "read_scene": case "search_content": {
      if (input.sourceHead === undefined) return reject("INVALID_STATE");
      const result = await applyReadOperation({
        ...input, sourceHead: input.sourceHead, envelope,
      });
      switch (result.ok) {
        case false: return reject(result.code, result.message);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "request_art": {
      if (input.preparedArt === undefined) return reject("INVALID_STATE");
      const result = await acknowledgeArtIntent({
        ...input, preparedArt: input.preparedArt, envelope,
      });
      switch (result.ok) {
        case false: return reject(result.code, result.message);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "project_overview": case "read_canon": {
      if (input.sourceHead === undefined) return reject("INVALID_STATE");
      const result = await applyInspectOperation({
        ...input, sourceHead: input.sourceHead, envelope,
      });
      switch (result.ok) {
        case false: return reject(result.code);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    case "validate_candidate": {
      if (input.preparedValidation === undefined) return reject("INVALID_STATE");
      const result = await applyValidationOperation({
        ...input, preparedValidation: input.preparedValidation, envelope,
      });
      switch (result.ok) {
        case false: return reject(result.code);
        case true: return publish(result.mutation);
        default: return assertNever(result);
      }
    }
    default: return assertNever(envelope);
  }
}
