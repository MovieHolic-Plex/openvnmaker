import { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type { CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { CanonEntry, CanonSection } from "./production-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type CanonOperationInput = CandidateToolInput & {
  readonly envelope: Extract<ToolEnvelope, { readonly tool: "propose_canon" }>;
};

function sectionEntries(section: CanonSection): readonly CanonEntry[] {
  switch (section.kind) {
    case "entries": return section.entries;
    case "art-direction": return section.rules;
    case "outline": return [];
    default: return assertNever(section);
  }
}

function sectionReferences(section: CanonSection) {
  switch (section.kind) {
    case "outline":
      return {
        scenes: [
          section.outline.start,
          ...section.outline.scenes.flatMap(scene => [
            scene.id,
            ...(scene.next === undefined ? [] : [scene.next]),
            ...(scene.choices ?? []).map(choice => choice.next),
          ]),
          ...(section.outline.endingOutcomes ?? []).map(outcome => outcome.endingId),
        ],
        characters: [],
      };
    case "entries": case "art-direction": {
      const entries = sectionEntries(section);
      return {
        scenes: entries.flatMap(entry => entry.sceneIds),
        characters: entries.flatMap(entry => [
          ...entry.characterIds,
          ...(entry.truth?.holderCharacterId === undefined
            ? [] : [entry.truth.holderCharacterId]),
        ]),
      };
    }
    default: return assertNever(section);
  }
}

export async function proposeCanonOperation(
  input: CanonOperationInput,
): Promise<ScriptMutationResult> {
  const { candidate, envelope, authorizedWriteSet } = input;
  const { sectionId, expectedSectionHash, replacement } = envelope.arguments;
  const authorized = authorizedWriteSet.some(write => {
    switch (write.target.kind) {
      case "canon":
        return write.target.sectionId === sectionId &&
          write.target.entryId === undefined && write.fields.includes("proposal");
      case "project": case "scene": case "line": case "choice":
      case "character": case "state": case "asset": return false;
      default: return assertNever(write.target);
    }
  });
  if (!authorized) return { ok: false, code: "WRITE_SCOPE_DENIED" };
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }
  const document = candidate.productionDocument;
  const sections = new Map<string, CanonSection>([
    ["castCanon", { kind: "entries", entries: document.castCanon }],
    ["worldTimeline", { kind: "entries", entries: document.worldTimeline }],
    ["branchFacts", { kind: "entries", entries: document.branchFacts }],
    ["artDirection", { kind: "art-direction", rules: document.artDirection }],
    ["outline", { kind: "outline", outline: document.outline }],
  ]);
  const current = sections.get(sectionId);
  if (!current || await canonicalHash(current) !== expectedSectionHash) {
    return { ok: false, code: "STALE_TARGET" };
  }
  if (current.kind !== replacement.kind) return { ok: false, code: "INVALID_OPERATION" };

  // A private proposed catalog checks references; it never replaces approved canon.
  const proposed = new Map(sections);
  proposed.set(sectionId, replacement);
  let outline = document.outline;
  switch (replacement.kind) {
    case "outline": outline = replacement.outline; break;
    case "entries": case "art-direction": break;
    default: return assertNever(replacement);
  }
  const beatIds = outline.scenes.map(scene => scene.id);
  if (new Set(beatIds).size !== beatIds.length) {
    return { ok: false, code: "INVALID_OPERATION" };
  }
  const scenes = new Set([...candidate.script.scenes.map(scene => scene.id), ...beatIds]);
  const characters = new Set(candidate.script.characters.map(character => character.id));
  const entries = [...proposed.values()].flatMap(sectionEntries);
  const entryIds = new Set(entries.map(entry => entry.id));
  if (entries.some(entry => entry.relatedEntryIds.some(id => !entryIds.has(id)))) {
    return { ok: false, code: "INVALID_OPERATION" };
  }
  for (const section of proposed.values()) {
    const refs = sectionReferences(section);
    if (refs.scenes.some(id => !scenes.has(id)) ||
        refs.characters.some(id => !characters.has(id))) {
      return { ok: false, code: "INVALID_OPERATION" };
    }
  }

  const previousRefs = sectionReferences(current);
  const nextRefs = sectionReferences(replacement);
  const artifact = { kind: "canon-proposal", ...envelope.arguments } as const;
  const artifactHash = await canonicalHash(artifact);
  // Canonical JSON preserves wire omission semantics for optional DTO fields.
  const serialized: unknown = JSON.parse(canonicalJson({
    ...artifact, artifactHash,
    affectedSceneIds: [...new Set([...previousRefs.scenes, ...nextRefs.scenes])].sort(),
    affectedCharacterIds: [
      ...new Set([...previousRefs.characters, ...nextRefs.characters]),
    ].sort(),
  }));
  const canonReads = await Promise.all([...sections].map(
    async ([id, section]) => ({
      kind: "entity", target: { kind: "canon", sectionId: id },
      hash: await canonicalHash(section),
    } as const),
  ));
  return {
    ok: true,
    mutation: {
      script: candidate.script,
      data: z.json().parse(serialized),
      readSet: [
        {
          kind: "entity", target: { kind: "project" },
          hash: await canonicalHash(candidate.script),
        },
        ...canonReads,
      ],
      writeSet: [],
    },
  };
}
