import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { readSceneContext, searchContext } from "./context.js";
import type {
  ContextSource, SceneContextResult, SearchContextResult,
} from "./context.js";
import type { CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { assertNever, errorCodeSchema } from "./primitives.js";
import type { HarnessErrorCode, ProjectHead } from "./primitives.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type ReadOperationInput = CandidateToolInput & {
  readonly sourceHead: ProjectHead;
  readonly envelope: Extract<ToolEnvelope, {
    readonly tool: "read_scene" | "search_content";
  }>;
};
type ReadOperationResult =
  | Extract<ScriptMutationResult, { readonly ok: true }>
  | {
    readonly ok: false;
    readonly code: HarnessErrorCode;
    readonly message: string;
  };

export async function applyReadOperation(
  input: ReadOperationInput,
): Promise<ReadOperationResult> {
  const source: ContextSource = {
    sourceHead: input.sourceHead,
    candidateRef: input.candidate.ref,
    script: input.candidate.script,
    productionDocument: input.candidate.productionDocument,
  };
  let result: SceneContextResult | SearchContextResult;
  switch (input.envelope.tool) {
    case "read_scene":
      result = await readSceneContext(source, input.envelope.arguments);
      break;
    case "search_content":
      result = await searchContext(source, input.envelope.arguments);
      break;
    default: return assertNever(input.envelope);
  }
  switch (result.kind) {
    case "blocked": {
      const code = errorCodeSchema.safeParse(result.reason);
      return {
        ok: false,
        code: code.success ? code.data : "INVALID_STATE",
        message: result.reason,
      };
    }
    case "ready": {
      const { readSet, ...data } = result;
      const serialized: unknown = JSON.parse(canonicalJson(data));
      return {
        ok: true,
        mutation: {
          script: input.candidate.script,
          data: z.json().parse(serialized),
          readSet,
          writeSet: [],
        },
      };
    }
    default: return assertNever(result);
  }
}
