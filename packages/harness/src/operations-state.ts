import { canonicalHash } from "./canonical.js";
import type { CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { assertNever } from "./primitives.js";
import { scriptSchema } from "./script-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type StateOperationInput = CandidateToolInput & {
  readonly envelope: Extract<ToolEnvelope, { readonly tool: "patch_state" }>;
};

type FlagCondition = {
  readonly all?: readonly string[] | undefined;
  readonly none?: readonly string[] | undefined;
  readonly compare?: readonly { readonly flag: string }[] | undefined;
};

function conditionUses(flagId: string, condition: FlagCondition | undefined): boolean {
  return condition?.all?.includes(flagId) ||
    condition?.none?.includes(flagId) ||
    condition?.compare?.some(comparison => comparison.flag === flagId) || false;
}

export async function applyStateOperation(
  input: StateOperationInput,
): Promise<ScriptMutationResult> {
  const { candidate, envelope, authorizedWriteSet } = input;
  const args = envelope.arguments;
  const ids = [...args.declare, ...args.setInitial, ...args.remove].map(row => row.id);
  const authorized = ids.every(id => authorizedWriteSet.some(write => {
    switch (write.target.kind) {
      case "state":
        return write.target.flagId === id && write.fields.includes("value");
      case "project": case "scene": case "line": case "choice":
      case "character": case "canon": case "asset": return false;
      default: return assertNever(write.target);
    }
  }));
  if (!authorized) return { ok: false, code: "WRITE_SCOPE_DENIED" };
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }
  const original = candidate.script.flags ?? {};
  const document = candidate.productionDocument;
  if (await canonicalHash(original) !== args.expectedStateHash) {
    return { ok: false, code: "STALE_TARGET" };
  }

  // Private state is published only after every declaration/change/removal succeeds.
  const flags = { ...original };
  for (const row of args.declare) {
    if (Object.hasOwn(flags, row.id)) return { ok: false, code: "STALE_TARGET" };
    flags[row.id] = row.value;
  }
  for (const row of args.setInitial) {
    if (!Object.hasOwn(flags, row.id) || flags[row.id] !== row.expectedValue) {
      return { ok: false, code: "STALE_TARGET" };
    }
    flags[row.id] = row.value;
  }
  for (const row of args.remove) {
    if (!Object.hasOwn(flags, row.id) || flags[row.id] !== row.expectedValue) {
      return { ok: false, code: "STALE_TARGET" };
    }
    const referenced = candidate.script.scenes.some(scene =>
      scene.lines.some(line => conditionUses(row.id, line.when)) ||
      scene.choices?.some(choice =>
        conditionUses(row.id, choice.when) ||
        Object.hasOwn(choice.set ?? {}, row.id) ||
        Object.hasOwn(choice.add ?? {}, row.id)));
    const productionReferenced = [
      ...document.castCanon, ...document.worldTimeline,
      ...document.branchFacts, ...document.artDirection,
    ].some(entry => entry.applicability?.anyOf.some(
      condition => conditionUses(row.id, condition),
    )) || document.outline.scenes.some(scene => scene.choices?.some(choice =>
      conditionUses(row.id, choice.when) ||
      Object.hasOwn(choice.set ?? {}, row.id) ||
      Object.hasOwn(choice.add ?? {}, row.id))) ||
      document.outline.endingOutcomes?.some(outcome =>
        Object.hasOwn(outcome.requiredRouteState, row.id));
    if (referenced || productionReferenced) {
      return { ok: false, code: "REFERENCED_ENTITY" };
    }
    Reflect.deleteProperty(flags, row.id);
  }
  const parsed = scriptSchema.safeParse({ ...candidate.script, flags });
  if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
  const sections = {
    castCanon: { kind: "entries", entries: document.castCanon },
    worldTimeline: { kind: "entries", entries: document.worldTimeline },
    branchFacts: { kind: "entries", entries: document.branchFacts },
    artDirection: { kind: "art-direction", rules: document.artDirection },
    outline: { kind: "outline", outline: document.outline },
  } as const;
  const productionReads = args.remove.length === 0 ? [] : await Promise.all(
    Object.entries(sections).map(async ([sectionId, section]) => ({
      kind: "entity", target: { kind: "canon", sectionId },
      hash: await canonicalHash(section),
    } as const)),
  );
  return {
    ok: true,
    mutation: {
      script: parsed.data, data: null,
      readSet: [
        {
          kind: "entity", target: { kind: "project" },
          hash: await canonicalHash(candidate.script),
        },
        ...productionReads,
      ],
      writeSet: ids.map(flagId => ({
        target: { kind: "state", flagId }, fields: ["value"],
      })),
    },
  };
}
