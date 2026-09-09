import type { ReuseAnalysis } from "@vnmaker/harness";
import { StatusBadge, type QualityTone } from "./QualityReport.js";

function classTone(value: string): QualityTone {
  switch (value) {
    case "eligible": return "success";
    case "needs-review": return "warning";
    case "conflict": return "error";
    case "unavailable": return "incomplete";
    default: return "incomplete";
  }
}

export function ReuseReview({
  analysis, busy, onRepropose,
}: {
  readonly analysis: ReuseAnalysis | null;
  readonly busy: boolean;
  readonly onRepropose: () => void;
}) {
  return <section className="harness-reuse" data-testid="harness-reuse-review">
    <div className="harness-row">
      <h3>재사용 검토</h3>
      <button type="button" className="studio-button" data-testid="harness-repropose" disabled={busy} onClick={onRepropose}>
        최신 원고로 다시 제안
      </button>
    </div>
    {analysis === null ? <p data-testid="harness-reuse-empty">분석 없음</p> : <>
      <p data-testid="harness-reuse-digest" data-digest={analysis.analysisDigest}>{analysis.analysisId}</p>
      <ul data-testid="harness-reuse-units">
        {analysis.units.map(unit => <li key={unit.unitId} data-classification={unit.classification} data-testid={`harness-reuse-unit-${unit.unitId}`}>
          <StatusBadge kind={classTone(unit.classification)} label={unit.classification} testId={`harness-reuse-class-${unit.unitId}`} />
          {unit.reasons.join(",")}
        </li>)}
      </ul>
      <p data-testid="harness-reuse-reviews" data-count={analysis.requiredReviews.length}>{analysis.requiredReviews.length}</p>
    </>}
  </section>;
}
