import { assertNever, canonicalJson, canonicalHash, HarnessError, parseReuseAnalysis, uuidSchema } from "../../../harness/src/index.js";
import type { ProjectHead, ReuseAnalysis, Unit } from "../../../harness/src/index.js";

export type ScriptScenes = { readonly scenes: readonly { readonly id: string }[] };
export type AnalyzeReuseInput = {
  readonly analysisId?: string;
  readonly runId?: string;
  readonly sourceHead: ProjectHead;
  readonly newBaseHead: ProjectHead;
  readonly currentScript: ScriptScenes;
  readonly newScript: ScriptScenes;
  readonly currentDocument?: unknown;
  readonly newDocument?: unknown;
  readonly units: readonly Unit[];
  readonly sourceProposalId?: string;
  readonly sourceCandidateSnapshotId?: string;
  readonly sourceDigest: string;
};

function sceneMap(script: ScriptScenes): Map<string, string> {
  const map = new Map<string, string>();
  for (const scene of script.scenes) map.set(scene.id, canonicalJson(scene));
  return map;
}

function sceneWrites(unit: Extract<Unit, { status: "ready" }>): readonly string[] {
  const ids: string[] = [];
  for (const item of unit.provenance.writeSet) {
    if (item.target.kind === "scene") ids.push(item.target.sceneId);
  }
  return ids;
}

function sceneReads(unit: Extract<Unit, { status: "ready" }>): readonly string[] {
  const ids: string[] = [];
  for (const item of unit.provenance.readSet) {
    if (item.kind === "entity" && item.target.kind === "scene") ids.push(item.target.sceneId);
  }
  return ids;
}

function classifyUnit(unit: Unit, before: Map<string, string>, after: Map<string, string>): ReuseAnalysis["units"][number] {
  switch (unit.status) {
    case "ready": break;
    case "pending": case "running": case "failed": case "cancelled": case "blocked":
      return { unitId: unit.id, classification: "unavailable", reasons: ["output-missing"], changedDependencies: [] };
    default: return assertNever(unit);
  }
  const writes = sceneWrites(unit);
  const reads = sceneReads(unit);
  if (writes.some(id => before.get(id) !== after.get(id) || !after.has(id))) {
    return { unitId: unit.id, classification: "conflict", reasons: ["target-changed"], changedDependencies: [] };
  }
  if (reads.some(id => before.get(id) !== after.get(id))) {
    return { unitId: unit.id, classification: "needs-review", reasons: ["read-changed"], changedDependencies: [] };
  }
  return { unitId: unit.id, classification: "eligible", reasons: [], changedDependencies: [] };
}

/** Pure reuse classification. Never records effects or schedules generation. */
export async function analyzeReuse(input: AnalyzeReuseInput): Promise<ReuseAnalysis> {
  if (input.sourceHead.projectId !== input.newBaseHead.projectId ||
      input.sourceHead.lineageId !== input.newBaseHead.lineageId) {
    throw new HarnessError("STALE_HEAD");
  }
  const units = input.units.map(unit => classifyUnit(unit, sceneMap(input.currentScript), sceneMap(input.newScript)));
  const requiredReviews = units.filter(row => row.classification === "needs-review").map(row => row.unitId);
  const requiredRepairs = units.filter(row => row.classification === "conflict").map(row => row.unitId);
  const analysisId = uuidSchema.parse(input.analysisId ?? "00000000-0000-4000-8000-0000000000aa");
  const body = {
    analysisId, sourceDigest: input.sourceDigest, newBaseHead: input.newBaseHead,
    units, assets: [] as const, requiredReviews, requiredRepairs,
  };
  return parseReuseAnalysis({ ...body, analysisDigest: await canonicalHash(body) });
}

export type ReproposePlan = {
  readonly scheduleGeneration: false;
  readonly generationRequiredUnitIds: readonly string[];
  readonly reuseUnitIds: readonly string[];
};

/** Assemble a new candidate plan. Must not schedule provider generation. */
export function planReproposedCandidate(input: {
  readonly reuseUnitIds: readonly string[];
  readonly reuseAssetIds: readonly string[];
  readonly resolutions: readonly { readonly kind: string; readonly unitId?: string }[];
  readonly units: readonly { readonly unitId: string; readonly classification: string }[];
}): ReproposePlan {
  void input.reuseAssetIds;
  const generation: string[] = [];
  const reused = new Set(input.reuseUnitIds);
  for (const unit of input.units) {
    if (reused.has(unit.unitId)) {
      if (unit.classification === "unavailable") throw new HarnessError("INVALID_INPUT");
      continue;
    }
    if (unit.classification !== "eligible") generation.push(unit.unitId);
  }
  for (const resolution of input.resolutions) {
    if (resolution.kind === "regenerate-unit" && resolution.unitId !== undefined) generation.push(resolution.unitId);
  }
  return { scheduleGeneration: false, generationRequiredUnitIds: generation, reuseUnitIds: input.reuseUnitIds };
}
