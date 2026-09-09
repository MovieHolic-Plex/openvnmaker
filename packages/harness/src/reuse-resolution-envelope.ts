import { canonicalJson } from "./canonical.js";
import type { Candidate } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { HarnessErrorCode } from "./primitives.js";
import { reuseListEnvelopeSchema } from "./reuse-artifact-contracts.js";
import type { ReuseListEnvelope } from "./reuse-artifact-contracts.js";
import type { ResolvedReusePatch } from "./reuse-resolution-plan.js";

type EnvelopeResult =
  | { readonly kind: "ready"; readonly envelope: ReuseListEnvelope }
  | { readonly kind: "blocked"; readonly reason: HarnessErrorCode | "UNSUPPORTED_RESOLUTION" };

/** A distinct execution DTO, never a rewritten/rehashed historical artifact. */
export function buildResolvedListEnvelope(
  item: Extract<ResolvedReusePatch, { readonly action: "edit" }>,
): EnvelopeResult {
  const { envelope } = item.verified.patch;
  const operations: unknown[] = [];
  for (const step of item.steps) {
    switch (step.kind) {
      case "omit": break;
      case "preserve": operations.push(step.operation); break;
      case "fields": {
        const { operation, resolution } = step;
        const target = "lineId" in operation
          ? { kind: "line", sceneId: envelope.arguments.sceneId, lineId: operation.lineId }
          : { kind: "choice", sceneId: envelope.arguments.sceneId, choiceId: operation.choiceId };
        if (canonicalJson(target) !== canonicalJson(resolution.target)) {
          return { kind: "blocked", reason: "STALE_TARGET" };
        }
        const fields = new Set(resolution.fields);
        if (fields.size !== resolution.fields.length) return { kind: "blocked", reason: "INVALID_INPUT" };
        const allowed = new Set([...Object.keys(operation.patch.set), ...operation.patch.unset]);
        if (resolution.fields.some(field => !allowed.has(field))) {
          return { kind: "blocked", reason: "WRITE_SCOPE_DENIED" };
        }
        operations.push({
          ...operation, expectedEntityHash: resolution.expectedCurrentEntityHash,
          patch: {
            set: Object.fromEntries(Object.entries(operation.patch.set).filter(([field]) => fields.has(field))),
            unset: operation.patch.unset.filter(field => fields.has(field)),
          },
        });
        break;
      }
      default: return assertNever(step);
    }
  }
  const parsed = reuseListEnvelopeSchema.safeParse({
    ...envelope, arguments: { ...envelope.arguments, operations },
  });
  return parsed.success
    ? { kind: "ready", envelope: parsed.data }
    : { kind: "blocked", reason: "INVALID_OPERATION" };
}

export function buildCopiedListEnvelope(
  candidate: Candidate,
  item: Extract<ResolvedReusePatch, { readonly action: "copy" }>,
): EnvelopeResult {
  const { patch, selection } = item.verified;
  const { resolution } = item;
  const operation = patch.envelope.arguments.operations[0];
  if (patch.envelope.arguments.operations.length !== 1 || !operation) {
    return { kind: "blocked", reason: "UNSUPPORTED_RESOLUTION" };
  }
  switch (operation.kind) {
    case "insert": break;
    case "update": case "delete": case "move":
      return { kind: "blocked", reason: "UNSUPPORTED_RESOLUTION" };
    default: return assertNever(operation);
  }
  // The entire one-insertion payload is copied, with explicit stable per-entry keys.
  const additions = "lines" in operation
    ? { lines: operation.lines.map((entry, index) => ({
        ...entry, clientKey: `${resolution.clientKey}:${index}`,
      })) }
    : { choices: operation.choices.map((entry, index) => ({
        ...entry, clientKey: `${resolution.clientKey}:${index}`,
      })) };
  const parsed = reuseListEnvelopeSchema.safeParse({
    ...patch.envelope, callId: selection.receiptId,
    candidateId: candidate.ref.candidateId, expectedCandidateRevision: candidate.ref.revision,
    arguments: { sceneId: resolution.sceneId, operations: [{
      kind: "insert", gap: resolution.gap, ...additions,
    }] },
  });
  return parsed.success
    ? { kind: "ready", envelope: parsed.data }
    : { kind: "blocked", reason: "INVALID_OPERATION" };
}
