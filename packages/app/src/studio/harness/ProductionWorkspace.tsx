import { parseScript, type VnScript } from "@vnmaker/content";
import {
  buildPreviewSnapshot, candidateRefSchema, canonicalHash, DEFAULT_BUDGET_LIMITS, parseProjectHead, runIdSchema, sceneIdSchema, uuidSchema,
  type PreviewSnapshot, type ReuseAnalysis,
} from "@vnmaker/harness";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  analyzeHarnessReuse, createHarnessRun, getHarnessCapabilities, getHarnessRun,
  mutateHarnessRun, subscribeHarnessEvents, type AuthorRunView, type HarnessCapabilityView,
} from "../../api/harness.js";
import type { ProjectRepository } from "../projectRepository.js";
import { sameHead } from "../projects.js";
import {
  approveCandidatePlan, bindCandidateWorkspaceHooks, getBudgetMeter, getCandidateWorkspace, installFirstChapterCandidate, installUnwrittenNextCandidate,
  openCandidateWorkspace, patchCandidateScript, rememberOpenPreview, restoreCandidateWorkspace,
  subscribeCandidateWorkspace,
} from "./candidateStore.js";
import { CandidatePreview } from "./CandidatePreview.js";
import { emitHarnessUi, persistActiveRun, readActiveRun } from "./harnessEvents.js";
import { ProposalDiffList } from "./ProposalDiffList.js";
import { ProposalReview } from "./ProposalReview.js";
import { RunEnvironment } from "./RunEnvironment.js";
import { SceneUnitList } from "./SceneUnitList.js";
import { StatusBadge } from "./QualityReport.js";
import "./harness.css";

const TABS = [
  { id: "planning", name: "기획" }, { id: "work", name: "작업" }, { id: "changes", name: "후보 변경" },
  { id: "review", name: "검수" }, { id: "environment", name: "실행 환경" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function ProductionWorkspace({
  repository, script, onNotice,
}: {
  readonly repository: ProjectRepository | null;
  readonly script: VnScript;
  readonly onNotice: (message: string) => void;
}) {
  const candidate = useSyncExternalStore(subscribeCandidateWorkspace, getCandidateWorkspace, getCandidateWorkspace);
  const meter = useSyncExternalStore(subscribeCandidateWorkspace, getBudgetMeter, getBudgetMeter);
  const [tab, setTab] = useState<TabId>("planning");
  const [brief, setBrief] = useState("");
  const [instruction, setInstruction] = useState("");
  const [run, setRun] = useState<AuthorRunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<HarnessCapabilityView | null>(null);
  const [analysis, setAnalysis] = useState<ReuseAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<"exact-only" | "bounded-payload">("exact-only");
  const [boundedConfirmed, setBoundedConfirmed] = useState(false);
  const [streamNonce, setStreamNonce] = useState(0);

  useEffect(() => { bindCandidateWorkspaceHooks(); emitHarnessUi("ready", { view: "workspace" }); void getHarnessCapabilities().then(setCapabilities).catch(() => setCapabilities(null)); }, []);
  useEffect(() => {
    if (repository === null) return;
    const id = readActiveRun(repository.snapshot.head.projectId);
    if (id === null) return;
    void getHarnessRun(id).then(adopt).catch(() => undefined);
  }, [repository]);
  useEffect(() => {
    if (run === null) return;
    const controller = new AbortController();
    let unmounted = false;
    setDisconnected(false);
    const markDisconnected = (): void => {
      if (unmounted) return;
      setDisconnected(true);
      emitHarnessUi("disconnected", { runId: run.id });
    };
    void (async () => {
      try {
        for await (const event of subscribeHarnessEvents(run.id, -1, controller.signal)) {
          if (event.type === "state" && typeof event.payload === "object" && event.payload !== null && "run" in event.payload) {
            setRun(await getHarnessRun(run.id));
          }
        }
        markDisconnected();
      } catch { markDisconnected(); }
    })();
    const onDisconnect = () => controller.abort();
    window.addEventListener("vnmaker:harness-disconnect-request", onDisconnect);
    return () => {
      unmounted = true;
      controller.abort();
      window.removeEventListener("vnmaker:harness-disconnect-request", onDisconnect);
    };
  }, [run?.id, streamNonce]);
  useEffect(() => {
    if (repository === null || run === null) return;
    return repository.subscribe(() => {
      const stale = !sameHead(repository.snapshot.head, parseProjectHead(run.sourceHead));
      setConflict(stale);
      if (stale) emitHarnessUi("conflict", { sourceRevision: repository.snapshot.head.revision, runRevision: run.sourceHead.revision });
    });
  }, [repository, run]);

  async function adopt(next: AuthorRunView): Promise<void> {
    setRun(next);
    persistActiveRun(next.sourceHead.projectId, next.id);
    if (restoreCandidateWorkspace(next.id) === null && repository !== null) {
      openCandidateWorkspace({
        runId: next.id, sourceHead: parseProjectHead(next.sourceHead), candidateRef: candidateRefSchema.parse(next.candidateRef),
        script, productionDocument: repository.snapshot.productionDocument, brief, planApproved: false, openPreviewHash: null,
      });
    }
    emitHarnessUi("run", { runId: next.id, status: next.state.status });
  }
  async function createRun(): Promise<void> {
    if (repository === null || busy || !brief.trim()) return;
    setBusy(true); setError(null);
    try {
      const flushed = await repository.flushCurrent();
      const created = await createHarnessRun({
        requestId: crypto.randomUUID(), sourceHead: flushed.head, script: flushed.script,
        productionDocument: flushed.productionDocument, limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: policy,
        initialScope: "plan", brief: brief.trim(), targetMinutes: 240,
      });
      openCandidateWorkspace({
        runId: created.id, sourceHead: parseProjectHead(created.sourceHead), candidateRef: candidateRefSchema.parse(created.candidateRef),
        script: flushed.script, productionDocument: flushed.productionDocument, brief: brief.trim(), planApproved: false, openPreviewHash: null,
      });
      await adopt(created);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function command(action: "pause" | "cancel" | "resume" | "budget", body: object): Promise<void> {
    if (run === null) return;
    setBusy(true); setError(null);
    try { await adopt(await mutateHarnessRun(run.id, action, { requestId: crypto.randomUUID(), expectedRunVersion: run.version, ...body })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); onNotice(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function repropose(): Promise<void> {
    if (run === null || repository === null) return;
    setBusy(true); setError(null);
    try {
      const flushed = await repository.flushCurrent();
      const result = await analyzeHarnessReuse(run.id, {
        requestId: crypto.randomUUID(), expectedRunVersion: run.version, sourceCandidateSnapshotId: crypto.randomUUID(),
        sourceDigest: await canonicalHash(candidate?.script ?? flushed.script), newBaseHead: flushed.head,
        script: flushed.script, productionDocument: flushed.productionDocument,
      });
      setAnalysis(result);
      const next = await mutateHarnessRun(run.id, "repropose", {
        requestId: crypto.randomUUID(), expectedRunVersion: run.version, analysisId: result.analysisId,
        analysisDigest: result.analysisDigest, newBaseHead: flushed.head,
        reuseUnitIds: result.units.filter(unit => unit.classification === "eligible").map(unit => unit.unitId),
        reuseAssetIds: [], resolutions: [],
      });
      await adopt(next);
      emitHarnessUi("repropose", { runId: next.id, analysisId: result.analysisId });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function openPreview(): Promise<void> {
    if (candidate === null || repository === null) return;
    const built = await buildPreviewSnapshot({
      missingAssets: [], candidate: { ref: candidate.candidateRef, script: candidate.script, productionDocument: candidate.productionDocument },
      sourceHead: repository.snapshot.head, runId: runIdSchema.parse(candidate.runId), includedUnitHashes: [],
    }, {
      allowMissingAssetPlaceholders: false, previewId: uuidSchema.parse(crypto.randomUUID()),
      expectedCandidateRevision: candidate.candidateRef.revision, entry: { kind: "from-start", sceneId: sceneIdSchema.parse(candidate.script.start) },
    });
    if (!built.ok) { setError(built.code); return; }
    rememberOpenPreview(built.snapshot.snapshotHash);
    setPreview(built.snapshot);
    emitHarnessUi("preview", { previewId: built.snapshot.previewId, snapshotHash: built.snapshot.snapshotHash });
  }
  const planned = candidate?.productionDocument.outline.scenes.map(scene => scene.id) ?? [];
  const status = run?.state.status ?? "idle";
  return <section className="harness-workspace" data-testid="harness-workspace" data-run-id={run?.id ?? ""}>
    <header className="harness-head">
      <div data-testid="harness-source-scope" data-scope="source" data-revision={repository?.snapshot.head.revision ?? 0}>원본 · {script.title}</div>
      <div data-testid="harness-candidate-scope" data-scope="candidate" data-revision={candidate?.candidateRef.revision ?? 0} data-title={candidate?.script.title ?? ""}>후보 · {candidate?.script.title ?? "없음"}</div>
      <p role="status" data-testid="harness-status" data-status={status} data-disconnected={String(disconnected)}>{status}{run?.state.reason ? `:${run.state.reason}` : ""}</p>
      {conflict ? <StatusBadge kind="warning" label="stale-source" testId="harness-conflict" /> : null}
      {disconnected ? <StatusBadge kind="incomplete" label="stream-disconnected" testId="harness-disconnected" /> : null}
      <button type="button" data-testid="harness-pause" disabled={busy || run === null} onClick={() => void command("pause", { reason: "user" })}>일시정지</button>
      <button type="button" data-testid="harness-cancel" disabled={busy || run === null} onClick={() => void command("cancel", { reason: "user-cancel" })}>취소</button>
      <button type="button" data-testid="harness-resume" disabled={busy || run === null} onClick={() => void command("resume", { observedSourceHead: repository?.snapshot.head, capabilityBindingHash: "0".repeat(64) })}>작업 재개</button>
      <button type="button" data-testid="harness-reconnect" disabled={run === null} onClick={() => setStreamNonce(value => value + 1)}>스트림 다시 연결</button>
    </header>
    {error ? <div className="studio-alert" role="alert" data-testid="harness-error"><strong>작업 실패</strong><p>{error}</p><small>현재 작품은 변경되지 않았습니다.</small></div> : null}
    <nav className="harness-tabs" role="tablist" aria-label="제작 작업실">
      {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} data-testid={`harness-tab-${item.id}`} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.name}</button>)}
    </nav>
    {tab === "planning" && <div role="tabpanel" data-testid="harness-panel-planning">
      <label>brief<textarea data-testid="harness-brief" value={brief} maxLength={2000} onChange={event => setBrief(event.target.value)} /></label>
      <button type="button" className="studio-button primary" data-testid="harness-create-run" disabled={busy || repository === null || !brief.trim()} onClick={() => void createRun()}>작업 생성</button>
      <button type="button" className="studio-button" data-testid="harness-approve-plan" disabled={candidate === null} onClick={() => approveCandidatePlan(brief.trim() || candidate?.brief || "plan")}>이 제작 계획 승인</button>
    </div>}
    {tab === "work" && <div role="tabpanel" data-testid="harness-panel-work">
      <SceneUnitList script={candidate?.script ?? script} units={run?.units ?? []} />
      <label>instruction<input data-testid="harness-instruction" value={instruction} onChange={event => setInstruction(event.target.value)} /></label>
      <button type="button" data-testid="harness-patch-candidate" disabled={candidate === null || !instruction.trim()} onClick={() => { if (candidate === null) return; patchCandidateScript(parseScript({ ...candidate.script, title: instruction.trim() })); }}>후보에만 반영</button>
      <button type="button" data-testid="harness-first-chapter" disabled={candidate === null} onClick={() => installFirstChapterCandidate()}>첫 장 후보 초안</button>
      <button type="button" data-testid="harness-unwritten-next" disabled={candidate === null} onClick={() => installUnwrittenNextCandidate()}>미작성 다음 장면</button>
      <button type="button" data-testid="harness-play-candidate" disabled={candidate === null} onClick={() => void openPreview()}>후보에서 플레이</button>
    </div>}
    {tab === "changes" && <div role="tabpanel" data-testid="harness-panel-changes">
      <ProposalDiffList source={script} candidate={candidate?.script ?? script} />
    </div>}
    {tab === "review" && <div role="tabpanel" data-testid="harness-panel-review">
      <ProposalReview repository={repository} source={script} candidate={candidate?.script ?? script} planned={planned} analysis={analysis} busy={busy} applied={false} onRepropose={() => void repropose()} />
    </div>}
    {tab === "environment" && <div role="tabpanel" data-testid="harness-panel-environment">
      <RunEnvironment capabilities={capabilities} meter={meter} policy={policy} boundedConfirmed={boundedConfirmed} usedText={0} onPolicy={setPolicy} onConfirmBounded={setBoundedConfirmed} onIncrease={() => void command("budget", { limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: policy, expectedLimitVersion: run?.version ?? 0, reason: "increase" })} />
    </div>}
    {preview !== null ? <CandidatePreview snapshot={preview} latestRevision={candidate?.candidateRef.revision ?? preview.candidateRevision} planned={Math.max(planned.length, preview.materializedScenes.length)} onClose={() => setPreview(null)} onWriteScene={() => { setPreview(null); setTab("work"); }} onReload={() => void openPreview()} /> : null}
  </section>;
}
