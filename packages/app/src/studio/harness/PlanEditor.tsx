import { useEffect, useMemo, useState } from "react";
import { parseProductionDocument, type ProductionDocument } from "@vnmaker/harness";
import type { VnScript } from "@vnmaker/content";
import type { ProjectRepository } from "../projectRepository.js";
import { sameHead } from "../projects.js";
import type { CandidateWorkspace } from "./candidateStore.js";
import { approveCandidatePlan, patchCandidateDocument } from "./candidateStore.js";
import { PlanCanonFields } from "./PlanCanonFields.js";
import {
  canonChangeImpact, createPlanSession, openCandidateSession, pathDurationView,
  planContextView, planFailureMessage, reducePlanSession, validateAuthoredPlan, type PlanScope,
} from "./planEditorModel.js";
import { StatusBadge } from "./QualityReport.js";

function blankDocument(title: string, start: string): ProductionDocument {
  return parseProductionDocument({
    version: 1, brief: "", castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title, subtitle: "", bible: "", start, scenes: [] }, artDirection: [], referenceBindings: [],
  });
}

function activeDocument(
  scope: PlanScope, repository: ProjectRepository | null, candidate: CandidateWorkspace | null, script: VnScript,
): ProductionDocument {
  if (scope === "candidate" && candidate !== null) return candidate.productionDocument;
  if (repository !== null) return repository.snapshot.productionDocument;
  return blankDocument(script.title, script.start);
}

export function PlanEditor({
  repository, script, candidate, brief, onBrief, busy, onCreateRun, omittedIds = [],
}: {
  readonly repository: ProjectRepository | null;
  readonly script: VnScript;
  readonly candidate: CandidateWorkspace | null;
  readonly brief: string;
  readonly onBrief: (brief: string) => void;
  readonly busy: boolean;
  readonly onCreateRun: () => void;
  readonly omittedIds?: readonly string[];
}) {
  const [scope, setScope] = useState<PlanScope>("source");
  const [draft, setDraft] = useState(() => activeDocument("source", repository, candidate, script));
  const [outlineText, setOutlineText] = useState(() => JSON.stringify(draft.outline, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [affected, setAffected] = useState<readonly string[]>([]);
  const [staleUnits, setStaleUnits] = useState<readonly string[]>([]);
  const projectId = repository?.snapshot.head.projectId ?? "";
  const sourceRevision = repository?.snapshot.head.revision ?? 0;
  const candidateRevision = candidate?.candidateRef.revision ?? 0;
  const staleCandidate = candidate !== null && repository !== null && !sameHead(candidate.sourceHead, repository.snapshot.head);
  useEffect(() => {
    const next = activeDocument(scope, repository, candidate, script);
    setDraft(next);
    setOutlineText(JSON.stringify(next.outline, null, 2));
    setError(null);
  }, [scope, projectId, sourceRevision, candidate?.runId, candidateRevision]);
  useEffect(() => {
    onBrief(activeDocument(scope, repository, candidate, script).brief);
  }, [projectId, scope]);
  const duration = useMemo(() => pathDurationView(draft.outline), [draft.outline]);
  const context = useMemo(() => planContextView(draft, omittedIds), [draft, omittedIds]);
  const parsed = useMemo(() => validateAuthoredPlan(draft, "manual"), [draft]);
  function assemble(): ProductionDocument | null {
    try {
      const outlineRaw: unknown = JSON.parse(outlineText);
      return parseProductionDocument({ ...draft, brief, outline: outlineRaw });
    } catch { setError("설계 JSON을 읽지 못했습니다."); return null; }
  }
  function persist(document: ProductionDocument, origin: "manual" | "generated"): boolean {
    const check = validateAuthoredPlan(document, origin);
    if (!check.ok) { setError(planFailureMessage(check.reason)); return false; }
    const previous = activeDocument(scope, repository, candidate, script);
    const units = previous.outline.scenes.map(scene => ({
      unitId: `draft:${scene.id}`, kind: "scene-draft" as const, sceneIds: [scene.id], factIds: [], status: "ready" as const,
    }));
    const impact = canonChangeImpact(previous, document, units);
    if (scope === "source") {
      if (repository === null) return false;
      repository.stage(script, document);
      void repository.flushCurrent().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    } else {
      if (candidate === null) { setError(planFailureMessage("no-candidate")); return false; }
      patchCandidateDocument(document);
    }
    setDraft(document);
    setAffected(impact.affectedSceneIds);
    setStaleUnits(impact.staleUnitIds);
    setError(null);
    return true;
  }
  function save(origin: "manual" | "generated"): void {
    const document = assemble();
    if (document !== null) persist(document, origin);
  }
  function approve(): void {
    if (candidate === null || repository === null) return;
    const document = assemble();
    if (document === null) return;
    const session = {
      ...openCandidateSession(createPlanSession(projectId, repository.snapshot.productionDocument)),
      sourceRevision, candidateRevision, candidateDocument: document,
      candidateBaseRevision: candidate.sourceHead.revision,
    };
    const result = reducePlanSession(session, { kind: "approve-candidate" });
    if (!result.ok) { setError(planFailureMessage(result.reason)); return; }
    approveCandidatePlan(brief.trim() || candidate.brief || "plan");
    setError(null);
  }
  return <section className="harness-plan" data-testid="harness-plan-editor" data-scope={scope} data-project-id={projectId} data-plan-approved={String(candidate?.planApproved ?? false)}>
    <div className="harness-row">
      <button type="button" data-testid="harness-plan-scope-source" className={scope === "source" ? "is-active" : ""} onClick={() => setScope("source")}>원본 설정</button>
      <button type="button" data-testid="harness-plan-scope-candidate" className={scope === "candidate" ? "is-active" : ""} onClick={() => setScope("candidate")}>후보 설정</button>
      <span data-testid="harness-plan-source-revision" data-revision={sourceRevision}>원본 r{sourceRevision}</span>
      <span data-testid="harness-plan-candidate-revision" data-revision={candidateRevision}>후보 r{candidateRevision}</span>
      {staleCandidate ? <StatusBadge kind="warning" label="stale-candidate" testId="harness-plan-stale" /> : null}
    </div>
    <label>brief<textarea data-testid="harness-brief" value={brief} maxLength={2000} onChange={event => onBrief(event.target.value)} /></label>
    <label>outline JSON<textarea data-testid="harness-plan-outline" value={outlineText} rows={8} onChange={event => setOutlineText(event.target.value)} /></label>
    <p data-testid="harness-plan-path-duration" data-min={duration.minMinutes ?? ""} data-max={duration.maxMinutes ?? ""} data-sum={duration.summedMinutes}>경로별 분량 {duration.label}</p>
    <PlanCanonFields document={draft} onChange={setDraft} onError={setError} />
    <section>
      <h3>모델 맥락</h3>
      <ul data-testid="harness-plan-context-sources">{context.sourceIds.map(id => <li key={id} data-testid={`harness-plan-source-${id}`}>{id}</li>)}</ul>
      <ul data-testid="harness-plan-context-omissions">{context.omitted.map(row => <li key={row.id} data-reason={row.reason}>{row.id}</li>)}</ul>
    </section>
    <p data-testid="harness-plan-affected-units" data-scenes={affected.join(",")} data-units={staleUnits.join(",")}>영향 씬 {affected.join(", ") || "없음"}</p>
    {error ? <div className="studio-alert" role="alert" data-testid="harness-plan-error">{error}</div> : null}
    {!parsed.ok ? <div className="studio-alert" role="alert" data-testid="harness-plan-invalid">{planFailureMessage(parsed.reason)}</div> : null}
    <div className="harness-row">
      <button type="button" className="studio-button primary" data-testid="harness-create-run" disabled={busy || repository === null || !brief.trim()} onClick={onCreateRun}>작업 생성</button>
      <button type="button" className="studio-button" data-testid="harness-plan-save" onClick={() => save("manual")}>설정 저장</button>
      <button type="button" className="studio-button" data-testid="harness-plan-apply-generated" onClick={() => save("generated")}>생성 설계 적용</button>
      <button type="button" className="studio-button" data-testid="harness-approve-plan" disabled={candidate === null || staleCandidate} onClick={approve}>이 제작 계획 승인</button>
    </div>
  </section>;
}
