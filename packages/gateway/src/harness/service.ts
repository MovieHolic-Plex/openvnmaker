import {
  buildPreviewSnapshot, canonicalHash, canonicalJson, decisionAckSchema, HarnessError, parseCreateRunCommand,
  parseDto, parseProductionDocument, parseReuseAnalysisCommand, parseRunCommand, previewCommandSchema,
  scriptSchema, uuidSchema,
} from "../../../harness/src/index.js";
import type { DecisionReceipt, PreviewSnapshot, ProductionRunner, ReuseAnalysis, Run, RunnerClock, RunnerIds, RunnerStore } from "../../../harness/src/index.js";
import { toAuthorRunView } from "./author-view.js";
import type { AuthorRunView } from "./author-view.js";
import { parseJsonObject } from "./body.js";
import { runFromCreate } from "./create-run.js";
import { EventLog } from "./events.js";
import { analyzeReuse, planReproposedCandidate } from "./repropose.js";

export type HarnessBindings = {
  readonly runner: ProductionRunner;
  readonly store: RunnerStore;
  readonly ids: RunnerIds;
  readonly clock: RunnerClock;
  readonly dispatchCount: () => number;
};
export type JsonResult = { readonly status: number; readonly body: unknown };
type Workspace = {
  readonly script: unknown;
  readonly productionDocument: unknown;
  readonly continuation: { readonly thought: "SECRET_THOUGHT" };
  readonly reviewDigest: string;
};
const DEFAULT_REVIEW = "a".repeat(64);

export type HarnessService = {
  readonly events: EventLog;
  readonly dispatchCount: () => number;
  readonly remember: (runId: string, script: unknown, productionDocument: unknown) => void;
  readonly createRun: (text: string) => Promise<JsonResult>;
  readonly getRun: (id: string) => JsonResult;
  readonly listRuns: (projectId: string | undefined, lineageId: string | undefined, cursor: string | undefined, limitRaw: string | undefined) => JsonResult;
  readonly mutate: (runId: string, action: "start" | "approve" | "request-changes" | "pause" | "resume" | "budget" | "retry-effect" | "cancel" | "repropose", text: string) => Promise<JsonResult>;
  readonly reuseAnalysis: (runId: string, text: string) => Promise<JsonResult>;
  readonly getAnalysis: (runId: string, analysisId: string) => JsonResult;
  readonly preview: (runId: string, text: string) => Promise<JsonResult>;
  readonly getPreview: (runId: string, previewId: string) => JsonResult;
  readonly getProposal: (runId: string, proposalId: string) => JsonResult;
  readonly decision: (runId: string, kind: "applied" | "rejected", text: string) => JsonResult;
  readonly getArtifact: (id: string) => { readonly status: number; readonly mime?: string; readonly bytes?: Uint8Array; readonly body?: unknown };
};

export function createHarnessService(bindings: HarnessBindings): HarnessService {
  const { runner, store, ids, clock, dispatchCount } = bindings;
  const events = new EventLog();
  const workspaces = new Map<string, Workspace>();
  const analyses = new Map<string, ReuseAnalysis>();
  const analysisReceipts = new Map<string, { readonly hash: string; readonly analysis: ReuseAnalysis }>();
  const createReceipts = new Map<string, { readonly hash: string; readonly run: Run }>();
  const previews = new Map<string, PreviewSnapshot>();
  const decisions = new Map<string, DecisionReceipt>();
  const record = (run: Run): AuthorRunView => {
    const view = toAuthorRunView(run);
    events.append(run.id, "state", { run: view }, run.lastEventSeq);
    return view;
  };
  const load = (id: string) => {
    const snapshot = store.load(id);
    if (snapshot === null) throw new HarnessError("INVALID_STATE");
    return snapshot;
  };
  const remember = (runId: string, script: unknown, productionDocument: unknown): void => {
    workspaces.set(runId, { script, productionDocument, continuation: { thought: "SECRET_THOUGHT" }, reviewDigest: DEFAULT_REVIEW });
  };
  return {
    events, dispatchCount, remember,
    async createRun(text) {
      const command = parseCreateRunCommand(parseJsonObject(text));
      const hash = await canonicalHash(command);
      const prior = createReceipts.get(command.requestId);
      if (prior !== undefined) {
        if (prior.hash !== hash) throw new HarnessError("ID_PAYLOAD_CONFLICT");
        return { status: 202, body: { run: toAuthorRunView(prior.run) } };
      }
      const created = await runner.create(command.requestId, runFromCreate(command, ids, new Date(clock.now()).toISOString()));
      createReceipts.set(command.requestId, { hash, run: created });
      remember(created.id, command.script, command.productionDocument);
      return { status: 202, body: { run: record(created) } };
    },
    getRun(id) { return { status: 200, body: toAuthorRunView(load(id).run) }; },
    listRuns(projectId, lineageId, cursor, limitRaw) {
      const limit = Math.min(50, Math.max(1, Number(limitRaw ?? "20") || 20));
      const rows = store.list().map(id => store.load(id)?.run).flatMap(run => run === undefined ? [] : [run])
        .filter(run => (projectId === undefined || run.sourceHead.projectId === projectId) &&
          (lineageId === undefined || run.sourceHead.lineageId === lineageId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const start = cursor === undefined ? 0 : rows.findIndex(run => `${run.createdAt}~${run.id}` === cursor) + 1;
      const slice = rows.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + limit);
      return { status: 200, body: { runs: slice.map(toAuthorRunView), cursor: slice.length === 0 ? null : `${slice[slice.length - 1]?.createdAt}~${slice[slice.length - 1]?.id}` } };
    },
    async mutate(runId, action, text) {
      const json = parseJsonObject(text);
      if (typeof json !== "object" || json === null) throw new HarnessError("INVALID_INPUT");
      if (action === "approve") {
        const digest = "reviewDigest" in json ? json.reviewDigest : undefined;
        if (digest !== (workspaces.get(runId)?.reviewDigest ?? DEFAULT_REVIEW)) throw new HarnessError("STALE_REVIEW");
      }
      if (action === "repropose") return repropose(runId, json);
      const run = await runner.apply(runId, parseRunCommand({ ...json, action }));
      return { status: 202, body: { run: record(run) } };
    },
    async reuseAnalysis(runId, text) {
      const command = parseReuseAnalysisCommand(parseJsonObject(text));
      const hash = await canonicalHash(command);
      const prior = analysisReceipts.get(command.requestId);
      if (prior !== undefined) {
        if (prior.hash !== hash) throw new HarnessError("ID_PAYLOAD_CONFLICT");
        return { status: 200, body: prior.analysis };
      }
      const snapshot = load(runId);
      if (snapshot.run.version !== command.expectedRunVersion) throw new HarnessError("STALE_HEAD");
      const analysis = await analyzeReuse({
        analysisId: ids.uuid(), sourceHead: snapshot.run.sourceHead, newBaseHead: command.newBaseHead,
        currentScript: asScenes(workspaces.get(runId)?.script) ?? asScenes(command.script) ?? { scenes: [] },
        newScript: asScenes(command.script) ?? { scenes: [] }, units: snapshot.run.units, sourceDigest: command.sourceDigest,
      });
      analyses.set(`${runId}:${analysis.analysisId}`, analysis);
      analysisReceipts.set(command.requestId, { hash, analysis });
      return { status: 200, body: analysis };
    },
    getAnalysis(runId, analysisId) {
      const row = analyses.get(`${runId}:${analysisId}`);
      if (row === undefined) throw new HarnessError("INVALID_STATE");
      return { status: 200, body: row };
    },
    async preview(runId, text) {
      const command = parseDto(previewCommandSchema, parseJsonObject(text));
      const snapshot = load(runId);
      const ws = workspaces.get(runId);
      if (ws === undefined) throw new HarnessError("INVALID_STATE");
      const built = await buildPreviewSnapshot({
        missingAssets: [], candidate: {
          ref: snapshot.run.candidateRef, script: scriptSchema.parse(ws.script),
          productionDocument: parseProductionDocument(ws.productionDocument),
        }, sourceHead: snapshot.run.sourceHead, runId: snapshot.run.id, includedUnitHashes: [],
      }, {
        allowMissingAssetPlaceholders: command.allowMissingAssetPlaceholders, previewId: uuidSchema.parse(ids.uuid()),
        expectedCandidateRevision: command.expectedCandidateRevision, entry: command.entry,
      });
      if (!built.ok) throw new HarnessError(built.code);
      previews.set(`${runId}:${built.snapshot.previewId}`, built.snapshot);
      return { status: 200, body: built.snapshot };
    },
    getPreview(runId, previewId) {
      const row = previews.get(`${runId}:${previewId}`);
      if (row === undefined) throw new HarnessError("INVALID_STATE");
      return { status: 200, body: row };
    },
    getProposal(runId, proposalId) {
      void runId; void proposalId;
      throw new HarnessError("INVALID_STATE");
    },
    decision(runId, kind, text) {
      void load(runId);
      const ack = parseDto(decisionAckSchema, parseJsonObject(text));
      if (ack.decisionReceipt.kind !== kind) throw new HarnessError("INVALID_INPUT");
      const key = `${ack.decisionReceipt.projectId}:${ack.decisionReceipt.lineageId}:${ack.decisionReceipt.proposalId}`;
      const existing = decisions.get(key);
      if (existing !== undefined) {
        if (existing.kind !== ack.decisionReceipt.kind || existing.proposalDigest !== ack.decisionReceipt.proposalDigest) {
          throw new HarnessError("DECISION_CONFLICT");
        }
        return { status: 200, body: existing };
      }
      decisions.set(key, ack.decisionReceipt);
      return { status: 200, body: ack.decisionReceipt };
    },
    getArtifact(id) {
      void id;
      throw new HarnessError("INVALID_STATE");
    },
  };

  async function repropose(runId: string, json: object): Promise<JsonResult> {
    const command = parseRunCommand({ ...json, action: "repropose" });
    if (command.action !== "repropose") throw new HarnessError("INVALID_INPUT");
    const analysis = analyses.get(`${runId}:${command.analysisId}`);
    if (analysis === undefined) throw new HarnessError("INVALID_STATE");
    if (analysis.analysisDigest !== command.analysisDigest) throw new HarnessError("STALE_HEAD");
    if (canonicalJson(analysis.newBaseHead) !== canonicalJson(command.newBaseHead)) throw new HarnessError("STALE_HEAD");
    const plan = planReproposedCandidate({
      reuseUnitIds: command.reuseUnitIds, reuseAssetIds: command.reuseAssetIds,
      resolutions: command.resolutions, units: analysis.units,
    });
    if (plan.scheduleGeneration) throw new HarnessError("INVALID_STATE");
    const run = await runner.apply(runId, command);
    return { status: 202, body: { run: record(run) } };
  }
}

function asScenes(value: unknown): { readonly scenes: readonly { readonly id: string }[] } | undefined {
  if (typeof value !== "object" || value === null || !("scenes" in value) || !Array.isArray(value.scenes)) return undefined;
  return value as { readonly scenes: readonly { readonly id: string }[] };
}
