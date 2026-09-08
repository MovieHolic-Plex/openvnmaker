import { applyChoiceFlags, choiceAllowed, lineAllowed } from "@vnmaker/content";
import type { StoryFlags } from "@vnmaker/content";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type {
  BranchContextRequest, BranchContextResult, BranchReadResult, ContextSource,
} from "./context.js";
import type { ContextManifest, ReadSet } from "./context-contracts.js";
import { assertNever, sceneIdSchema } from "./primitives.js";
import type { SceneId } from "./primitives.js";
import type { CanonEntry, CanonSection } from "./production-contracts.js";

const canonSections = [
  "castCanon", "worldTimeline", "branchFacts", "artDirection",
] as const;

function predecessorIds(
  script: BranchContextRequest["script"],
  sceneId: SceneId,
): ReadonlySet<string> {
  const predecessors = new Map<string, string[]>();
  for (const scene of script.scenes) {
    const targets = scene.choices?.length
      ? scene.choices.map(choice => choice.next)
      : !scene.ending && scene.next ? [scene.next] : [];
    for (const target of targets) {
      const incoming = predecessors.get(target) ?? [];
      incoming.push(scene.id);
      predecessors.set(target, incoming);
    }
  }
  const relevant = new Set<string>([sceneId]);
  const pending: string[] = [sceneId];
  for (const target of pending) {
    for (const predecessor of predecessors.get(target) ?? []) {
      if (relevant.has(predecessor)) continue;
      relevant.add(predecessor);
      pending.push(predecessor);
    }
  }
  return relevant;
}

export function buildBranchContext(
  request: BranchContextRequest,
): BranchContextResult {
  if (!Number.isSafeInteger(request.maxVisitedStates) || request.maxVisitedStates < 1) {
    return { kind: "blocked", reason: "INVALID_STATE_BOUND" };
  }
  const scenes = new Map(request.script.scenes.map(scene => [scene.id, scene]));
  if (!scenes.has(request.sceneId)) {
    return { kind: "blocked", reason: "SCENE_NOT_FOUND" };
  }
  const relevant = predecessorIds(request.script, request.sceneId);
  // Local accumulators enumerate arrival states without changing the script.
  const queue: { readonly id: string; readonly flags: StoryFlags }[] = [
    { id: request.script.start, flags: request.script.flags ?? {} },
  ];
  const visited = new Set<string>();
  const arrivals: StoryFlags[] = [];
  for (const state of queue) {
    if (!relevant.has(state.id)) continue;
    const key = canonicalJson(state);
    if (visited.has(key)) continue;
    if (visited.size >= request.maxVisitedStates) {
      return { kind: "blocked", reason: "STATE_BOUND_EXCEEDED" };
    }
    visited.add(key);
    const scene = scenes.get(state.id);
    if (!scene) return { kind: "blocked", reason: "SCENE_NOT_FOUND" };
    if (scene.id === request.sceneId) {
      arrivals.push(state.flags);
    }
    if (scene.choices?.length) {
      for (const choice of scene.choices) {
        if (choiceAllowed(choice, state.flags)) {
          queue.push({ id: choice.next, flags: applyChoiceFlags(state.flags, choice) });
        }
      }
    } else if (!scene.ending && scene.next) {
      queue.push({ id: scene.next, flags: state.flags });
    }
  }
  if (arrivals.length === 0) {
    return { kind: "blocked", reason: "SCENE_UNREACHABLE" };
  }
  const common: CanonEntry[] = [];
  const conditional: CanonEntry[] = [];
  for (const fact of request.facts) {
    const applicability = fact.applicability;
    if (applicability && !arrivals.some(flags =>
      applicability.anyOf.some(when => lineAllowed({
        when: {
          ...(when.all === undefined ? {} : { all: when.all }),
          ...(when.none === undefined ? {} : { none: when.none }),
          ...(when.compare === undefined ? {} : { compare: when.compare }),
        },
      }, flags)))) continue;
    const truth = fact.truth?.kind ?? "world";
    switch (truth) {
      case "world":
        (applicability ? conditional : common).push(fact);
        break;
      case "belief":
      case "rumour":
        conditional.push(fact);
        break;
      default: assertNever(truth);
    }
  }
  return { kind: "ready", common, conditional };
}

export async function readBranchContext(
  source: ContextSource,
  selection: Pick<BranchContextRequest, "sceneId" | "maxVisitedStates">,
): Promise<BranchReadResult> {
  const entries = canonSections.flatMap(sectionId =>
    source.productionDocument[sectionId].map(entry => ({ sectionId, entry })));
  const branch = buildBranchContext({
    ...selection, script: source.script, facts: entries.map(row => row.entry),
  });
  switch (branch.kind) {
    case "blocked": return branch;
    case "ready": break;
    default: return assertNever(branch);
  }

  const relevant = predecessorIds(source.script, selection.sceneId);
  const scenes = source.script.scenes.filter(scene => relevant.has(scene.id))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const sceneDependencies = await Promise.all(scenes.map(async scene => ({
    kind: "entity" as const,
    target: { kind: "scene" as const, sceneId: sceneIdSchema.parse(scene.id) },
    hash: await canonicalHash(scene),
  })));
  const selected = new Set([...branch.common, ...branch.conditional]);
  const facts = await Promise.all(entries.filter(row => selected.has(row.entry))
    .map(async row => ({ ...row, hash: await canonicalHash(row.entry) })));
  const canonDependencies = await Promise.all(canonSections.map(async sectionId => {
    const section = source.productionDocument[sectionId];
    const scope = { kind: "canon", sectionId } as const;
    const ids = section.map(entry => entry.id);
    const membership = [...ids].sort();
    let sectionValue: CanonSection;
    switch (sectionId) {
      case "artDirection":
        sectionValue = { kind: "art-direction", rules: section };
        break;
      case "castCanon":
      case "worldTimeline":
      case "branchFacts":
        sectionValue = { kind: "entries", entries: section };
        break;
      default: return assertNever(sectionId);
    }
    return [
      { kind: "entity", target: scope, hash: await canonicalHash(sectionValue) },
      {
        kind: "membership", scope, ids: membership,
        hash: await canonicalHash(membership),
      },
      { kind: "order", scope, ids, hash: await canonicalHash(ids) },
    ] satisfies ReadSet;
  }));
  const flags = source.script.flags ?? {};
  const readSet: ReadSet = [
    ...sceneDependencies,
    {
      kind: "query",
      query: canonicalJson({
        kind: "predecessor-scenes", sceneId: selection.sceneId,
      }),
      scope: [{ kind: "project" }],
      resultIds: sceneDependencies.map(dependency => canonicalJson(dependency.target)),
      hash: await canonicalHash(sceneDependencies),
    },
    {
      kind: "query", query: canonicalJson({ kind: "initial-state" }),
      scope: [{ kind: "project" }],
      resultIds: Object.keys(flags).sort().map(flagId =>
        canonicalJson({ kind: "state", flagId })),
      hash: await canonicalHash(flags),
    },
    ...canonDependencies.flat(),
    ...facts.map((row): ReadSet[number] => ({
      kind: "entity",
      target: { kind: "canon", sectionId: row.sectionId, entryId: row.entry.id },
      hash: row.hash,
    })),
  ];
  return {
    ...branch, readSet,
    facts: facts.map((row): ContextManifest["facts"][number] => ({
      factId: row.entry.id,
      sourceHead: source.sourceHead,
      sceneIds: row.entry.sceneIds,
      lineIds: [],
      sourceHash: row.hash,
      ...(row.entry.applicability === undefined
        ? {} : { applicability: row.entry.applicability }),
    })),
  };
}
