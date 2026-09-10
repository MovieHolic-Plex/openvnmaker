import { assertNever, type CheckStatus, type WorkspaceValidationReport } from "@vnmaker/harness";

export type QualityTone = "success" | "warning" | "error" | "incomplete" | "limit" | "info";

export function StatusBadge({ kind, label, testId }: { readonly kind: QualityTone; readonly label: string; readonly testId: string }) {
  return <span className={`harness-badge harness-badge-${kind}`} data-testid={testId} data-kind={kind}>{label}</span>;
}

function statusTone(status: CheckStatus): QualityTone {
  switch (status) {
    case "pass": return "success";
    case "fail": return "error";
    case "unverified": return "incomplete";
    default: return assertNever(status);
  }
}

export function QualityReport({
  report, applied, released, onApproveChapter,
}: {
  readonly report: WorkspaceValidationReport | null;
  readonly applied: boolean;
  readonly released: boolean;
  readonly onApproveChapter?: (chapterId: string) => void;
}) {
  const gate = report?.gate;
  return <section className="harness-quality" data-testid="harness-quality-report">
    <h3>검수</h3>
    <div className="harness-badge-row">
      <StatusBadge kind={gate?.previewEligible ? "info" : "incomplete"} label="preview-eligible" testId="harness-preview-eligible" />
      <StatusBadge kind={gate?.proposalReady ? "success" : "incomplete"} label="proposal-ready" testId="harness-proposal-ready" />
      <StatusBadge kind={applied ? "success" : "incomplete"} label="source-applied" testId="harness-applied-state" />
      <StatusBadge kind={released ? "success" : "incomplete"} label="release" testId="harness-release-state" />
    </div>
    <p data-testid="harness-written-planned" data-written={report?.writtenSceneCount ?? 0} data-planned={report?.plannedSceneCount ?? 0}>
      written {report?.writtenSceneCount ?? 0} / planned {report?.plannedSceneCount ?? 0}
    </p>
    {report === null || gate === undefined ? <StatusBadge kind="incomplete" label="validation-pending" testId="harness-validation-pending" /> : <>
      <ul>
        {(["schema", "graph", "condition", "assets", "runtime"] as const).map(check => (
          <li key={check} data-testid={`harness-check-${check}`} data-status={report.technical[check]} data-ok={String(report.technical[check] === "pass")}>
            <StatusBadge kind={statusTone(report.technical[check])} label={check} testId={`harness-${check}`} />
          </li>
        ))}
      </ul>
      <p data-testid="harness-content-evaluation" data-status={report.content.status} data-pending={String(gate.contentPending)} data-technical-green={String(gate.technicalGreen)}>
        <StatusBadge kind={report.content.status === "evaluated" ? "success" : "warning"} label={`content-${report.content.status}`} testId="harness-content-status" />
      </p>
      <p data-testid="harness-route-coverage" data-complete={String(report.routes.complete)} data-distinguishing={report.routes.distinguishing} data-exceeded={String(report.routes.exceededBound)}>
        {report.routes.distinguishing}
      </p>
      {report.routes.exceededBound ? <ul data-testid="harness-unverified-paths" data-complete="false">
        {report.routes.unverifiedPaths.map(path => <li key={path}>{path}</li>)}
      </ul> : null}
      <ul data-testid="harness-route-paths">
        {report.routes.paths.map(path => (
          <li key={path.pathId} data-ending={path.endingTitle ?? ""} data-chars={path.characterCount} data-minutes={path.estimatedMinutes ?? ""}>
            {path.pathId}
          </li>
        ))}
      </ul>
      <ul data-testid="harness-chapter-evaluations">
        {report.content.chapters.map(chapter => {
          const canApprove = (chapter.disposition === "pass" || chapter.disposition === "accepted-with-notes") && chapter.coverageComplete && !chapter.missingEvidence;
          return <li key={chapter.chapterId} data-testid={`harness-chapter-${chapter.chapterId}`} data-disposition={chapter.disposition} data-approved={String(chapter.approved)}>
            <StatusBadge kind={statusTone(chapter.disposition === "pass" || chapter.disposition === "accepted-with-notes" ? "pass" : chapter.disposition === "unverified" ? "unverified" : "fail")} label={chapter.disposition} testId={`harness-chapter-status-${chapter.chapterId}`} />
            <button type="button" className="studio-button" data-testid={`harness-approve-chapter-${chapter.chapterId}`} disabled={!canApprove || chapter.approved || onApproveChapter === undefined} onClick={() => onApproveChapter?.(chapter.chapterId)}>
              이 장 초안 승인
            </button>
          </li>;
        })}
      </ul>
      {report.repetition.length > 0 ? <p data-testid="harness-repetition" data-count={report.repetition.length}>repeated-body</p> : null}
      {report.missingStaging.length > 0 ? <p data-testid="harness-missing-staging" data-count={report.missingStaging.length}>missing-staging</p> : null}
    </>}
    {(report?.requiredAssetsMissing.length ?? 0) > 0 ? <StatusBadge kind="error" label="required-assets-missing" testId="harness-missing-assets" /> : null}
  </section>;
}
