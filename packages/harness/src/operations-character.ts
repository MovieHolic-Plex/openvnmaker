import { canonicalHash, canonicalJson } from "./canonical.js";
import type { CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { assertNever } from "./primitives.js";
import { scriptSchema } from "./script-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type CharacterOperationInput = CandidateToolInput & {
  readonly envelope: Extract<ToolEnvelope, { readonly tool: "upsert_character" }>;
};

export async function applyCharacterOperation(
  input: CharacterOperationInput,
): Promise<ScriptMutationResult> {
  const { candidate, envelope, authorizedWriteSet } = input;
  const { characterId, expectedCharacterHash, value } = envelope.arguments;
  const authorized = authorizedWriteSet.some(write => {
    switch (write.target.kind) {
      case "character":
        return write.target.characterId === characterId && write.fields.includes("value");
      case "project": case "scene": case "line": case "choice":
      case "state": case "canon": case "asset": return false;
      default: return assertNever(write.target);
    }
  });
  if (!authorized) return { ok: false, code: "WRITE_SCOPE_DENIED" };
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }
  const current = candidate.script.characters.find(character => character.id === characterId);
  if (expectedCharacterHash === null) {
    if (current) return { ok: false, code: "STALE_TARGET" };
  } else if (!current || await canonicalHash(current) !== expectedCharacterHash) {
    return { ok: false, code: "STALE_TARGET" };
  }

  const parsed = scriptSchema.safeParse({
    ...candidate.script,
    characters: current
      ? candidate.script.characters.map(character => character.id === characterId ? value : character)
      : [...candidate.script.characters, value],
  });
  if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
  const changed = current === undefined || canonicalJson(current) !== canonicalJson(value);
  const document = candidate.productionDocument;
  const entries = [
    ...document.castCanon, ...document.worldTimeline,
    ...document.branchFacts, ...document.artDirection,
  ];
  const affectedCanonEntryIds = changed ? [...new Set(entries
    .filter(entry => entry.characterIds.includes(characterId) ||
      entry.truth?.holderCharacterId === characterId)
    .map(entry => entry.id))] : [];
  const sections = {
    castCanon: { kind: "entries", entries: document.castCanon },
    worldTimeline: { kind: "entries", entries: document.worldTimeline },
    branchFacts: { kind: "entries", entries: document.branchFacts },
    artDirection: { kind: "art-direction", rules: document.artDirection },
  } as const;
  const canonReads = await Promise.all(Object.entries(sections).map(
    async ([sectionId, section]) => ({
      kind: "entity",
      target: { kind: "canon", sectionId },
      hash: await canonicalHash(section),
    } as const),
  ));
  return {
    ok: true,
    mutation: {
      script: parsed.data,
      data: { characterId, affectedCanonEntryIds },
      readSet: [
        {
          kind: "entity", target: { kind: "project" },
          hash: await canonicalHash(candidate.script),
        },
        ...canonReads,
      ],
      writeSet: [{ target: { kind: "character", characterId }, fields: ["value"] }],
    },
  };
}
