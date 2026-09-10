import { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import { contextCanonSection, contextCanonSectionIdSchema } from "./context-projections.js";
import type { ReadSet } from "./context-contracts.js";
import type { Candidate, CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { inspectProjectOverview, inspectionOverviewProjection, inspectionOverviewRecipeSchema } from "./operations-inspect-overview.js";
import { assertNever } from "./primitives.js";
import type { ProjectHead } from "./primitives.js";
import type { CanonEntry, CanonSection, ProductionDocument } from "./production-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type QueryDependency = Extract<ReadSet[number], { readonly kind: "query" }>;
export type InspectOperationInput = CandidateToolInput & {
  readonly sourceHead: ProjectHead;
  readonly envelope: Extract<ToolEnvelope, {
    readonly tool: "project_overview" | "read_canon";
  }>;
};

/**
 * Operation-owned binding catalog replay contract (version 1):
 * query = canonicalJson({kind:"inspection-approved-binding-catalog",version:1});
 * scope = [{kind:"project"}]. Both tools return exactly the complete approved
 * productionDocument.referenceBindings array, in stored order, without deduping.
 * Each result is {id:canonicalJson({assetId,role,target}),hash:canonicalHash(binding)}.
 * resultIds is the ordered result id list; hash = canonicalHash({query,scope,results}).
 * R5 replay recomputes this recipe from the comparison candidate's approved
 * production document. Additions, removals, order, multiplicity and all record
 * fields are dependencies, including both byte hashes and referenceVersionIds.
 * Neither sourceHead nor candidateRef enters this content hash. No byte existence,
 * provider effect or approval authority is established by catalog equality.
 * Unknown recipe versions fail closed. This is not an asset entity dependency
 * and does not reinterpret Task8's scene-window "reference-bindings" recipe.
 */
export async function inspectionBindingCatalogDependency(
  document: ProductionDocument,
): Promise<QueryDependency> {
  const query = canonicalJson({ kind: "inspection-approved-binding-catalog", version: 1 });
  const scope: QueryDependency["scope"] = [{ kind: "project" }];
  const results = await Promise.all(document.referenceBindings.map(async binding => ({
    id: canonicalJson({ assetId: binding.assetId, role: binding.role, target: binding.target }),
    hash: await canonicalHash(binding),
  })));
  return { kind: "query", query, scope, resultIds: results.map(row => row.id),
    hash: await canonicalHash({ query, scope, results }) };
}

export type InspectionQueryReplay =
  | { readonly kind: "current"; readonly current: QueryDependency }
  | { readonly kind: "unsupported"; readonly reason: "UNSUPPORTED_INSPECTION_QUERY" };

/**
 * Reconstruction only: "current" never means eligible. The evidence owner must
 * compare the complete dependency and validate every other read and authority.
 * Overview v1 replays metadata, the complete compact graph, and the offset/limit
 * summary page; its scope is project + outline and its hash is their projection.
 * Unsupported context replay cannot substitute for this operation-owned replay.
 */
export async function replayInspectionQuery(
  candidate: Candidate,
  recorded: ReadSet[number],
): Promise<InspectionQueryReplay> {
  const unsupported: InspectionQueryReplay = { kind: "unsupported", reason: "UNSUPPORTED_INSPECTION_QUERY" };
  switch (recorded.kind) {
    case "query": break;
    case "entity": case "membership": case "order": return unsupported;
    default: return assertNever(recorded);
  }
  let current: QueryDependency;
  if (recorded.query === canonicalJson({ kind: "inspection-approved-binding-catalog", version: 1 })) {
    current = await inspectionBindingCatalogDependency(candidate.productionDocument);
  } else {
    let value: unknown;
    try { value = JSON.parse(recorded.query); } catch (error) {
      if (error instanceof SyntaxError) return unsupported;
      throw error;
    }
    const recipe = inspectionOverviewRecipeSchema.safeParse(value);
    if (!recipe.success || canonicalJson(recipe.data) !== recorded.query) return unsupported;
    current = (await inspectionOverviewProjection(candidate, recipe.data)).dependency;
  }
  if (canonicalJson(recorded.scope) !== canonicalJson(current.scope)) return unsupported;
  return { kind: "current", current };
}

function entriesOf(section: CanonSection): readonly CanonEntry[] {
  switch (section.kind) {
    case "entries": return section.entries;
    case "art-direction": return section.rules;
    case "outline": return [];
    default: return assertNever(section);
  }
}

function filterSection(section: CanonSection, facts: ReadonlySet<string> | undefined): CanonSection {
  if (facts === undefined) return section;
  switch (section.kind) {
    case "entries": return { kind: "entries", entries: section.entries.filter(entry => facts.has(entry.id)) };
    case "art-direction": return { kind: "art-direction", rules: section.rules.filter(entry => facts.has(entry.id)) };
    case "outline": return section;
    default: return assertNever(section);
  }
}

export async function applyInspectOperation(input: InspectOperationInput): Promise<ScriptMutationResult> {
  const { candidate, envelope, sourceHead } = input;
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }
  const document = candidate.productionDocument;
  const bindingRead = await inspectionBindingCatalogDependency(document);
  const readSet: ReadSet[number][] = [bindingRead];
  let data: unknown;
  switch (envelope.tool) {
    case "project_overview": {
      const overview = await inspectProjectOverview(candidate, sourceHead, envelope.arguments);
      switch (overview.ok) {
        case false: return overview;
        case true: break;
        default: return assertNever(overview);
      }
      const canonVersions = await Promise.all(contextCanonSectionIdSchema.options.map(async sectionId => ({
        sectionId, hash: await canonicalHash(contextCanonSection(document, sectionId)),
      })));
      readSet.push(overview.dependency, ...canonVersions.map((row): ReadSet[number] => ({
        kind: "entity", target: { kind: "canon", sectionId: row.sectionId }, hash: row.hash,
      })));
      data = { sourceHead, candidateRef: candidate.ref, ...overview.data, canonVersions,
        assetVersions: await Promise.all(document.referenceBindings.map(async binding => ({
          binding, hash: await canonicalHash(binding),
        }))),
      };
      break;
    }
    case "read_canon": {
      const sectionIds = z.array(contextCanonSectionIdSchema).safeParse([...new Set(envelope.arguments.sectionIds)]);
      if (!sectionIds.success) return { ok: false, code: "STALE_TARGET" };
      const selected = sectionIds.data.map(sectionId => ({ sectionId, value: contextCanonSection(document, sectionId) }));
      const available = new Set(selected.flatMap(row => entriesOf(row.value).map(entry => entry.id)));
      const factIds = envelope.arguments.factIds;
      if (factIds?.some(id => !available.has(id))) return { ok: false, code: "STALE_TARGET" };
      const filter = factIds === undefined ? undefined : new Set(factIds);
      const sections = await Promise.all(selected.map(async row => ({
        sectionId: row.sectionId, sourceHash: await canonicalHash(row.value),
        value: filterSection(row.value, filter),
      })));
      const facts = await Promise.all(sections.flatMap(row => entriesOf(row.value).map(async entry => ({
        sectionId: row.sectionId, entry, sourceHead, sourceHash: await canonicalHash(entry),
      }))));
      readSet.push(...sections.map((row): ReadSet[number] => ({
        kind: "entity", target: { kind: "canon", sectionId: row.sectionId }, hash: row.sourceHash,
      })), ...facts.map((row): ReadSet[number] => ({
        kind: "entity", target: { kind: "canon", sectionId: row.sectionId, entryId: row.entry.id }, hash: row.sourceHash,
      })));
      data = { sourceHead, candidateRef: candidate.ref, sections, facts, referenceBindings: document.referenceBindings };
      break;
    }
    default: return assertNever(envelope);
  }
  const serialized: unknown = JSON.parse(canonicalJson(data));
  return { ok: true, mutation: { script: candidate.script, data: z.json().parse(serialized), readSet, writeSet: [] } };
}
