import { canonicalHash } from "./canonical.js";
import type { CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { assertNever } from "./primitives.js";
import { scriptSchema } from "./script-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type ProjectOperationInput = CandidateToolInput & {
  readonly envelope: Extract<ToolEnvelope, { readonly tool: "patch_project" }>;
};

export async function applyProjectOperation(
  input: ProjectOperationInput,
): Promise<ScriptMutationResult> {
  const { candidate, envelope, authorizedWriteSet } = input;
  const { patch, expectedMetadataHash } = envelope.arguments;
  const fields = [...Object.keys(patch.set), ...patch.unset];
  const authorized = fields.every(field => authorizedWriteSet.some(write => {
    switch (write.target.kind) {
      case "project": return write.fields.includes(field);
      case "scene": case "line": case "choice": case "character":
      case "canon": case "asset": case "state": return false;
      default: return assertNever(write.target);
    }
  }));
  if (!authorized) return { ok: false, code: "WRITE_SCOPE_DENIED" };
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }

  const { title, subtitle, start, artDirection, musicFadeSeconds, credits } = candidate.script;
  const metadata = { title, subtitle, start, artDirection, musicFadeSeconds, credits };
  if (await canonicalHash(metadata) !== expectedMetadataHash) {
    return { ok: false, code: "STALE_TARGET" };
  }
  const replacement = { ...candidate.script, ...patch.set };
  for (const field of patch.unset) Reflect.deleteProperty(replacement, field);
  const parsed = scriptSchema.safeParse(replacement);
  if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
  const target = { kind: "project" } as const;
  return {
    ok: true,
    mutation: {
      script: parsed.data, data: null,
      readSet: [{ kind: "entity", target, hash: await canonicalHash(candidate.script) }],
      writeSet: [{ target, fields }],
    },
  };
}
