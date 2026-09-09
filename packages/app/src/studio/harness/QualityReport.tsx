import type { ValidationReport } from "@vnmaker/harness";

export type QualityTone = "success" | "warning" | "error" | "incomplete" | "limit" | "info";

export function StatusBadge({ kind, label, testId }: { readonly kind: QualityTone; readonly label: string; readonly testId: string }) {
  return <span className={`harness-badge harness-badge-${kind}`} data-testid={testId} data-kind={kind}>{label}</span>;
}

function checkTone(ok: boolean): QualityTone {
  return ok ? "success" : "error";
}

export function QualityReport({
  validation, previewEligible, proposalReady, applied, released, written, planned,
}: {
  readonly validation: ValidationReport | null;
  readonly previewEligible: boolean;
  readonly proposalReady: boolean;
  readonly applied: boolean;
  readonly released: boolean;
  readonly written: number;
  readonly planned: number;
}) {
  const missing = validation?.requiredAssetsMissing ?? [];
  const complete = validation !== null
    && validation.schema && validation.graph && validation.assets && validation.runtime && missing.length === 0;
  return <section className="harness-quality" data-testid="harness-quality-report">
    <h3>검수</h3>
    <div className="harness-badge-row">
      <StatusBadge kind={previewEligible ? "info" : "incomplete"} label="preview-eligible" testId="harness-preview-eligible" />
      <StatusBadge kind={proposalReady && complete ? "success" : "incomplete"} label="proposal-ready" testId="harness-proposal-ready" />
      <StatusBadge kind={applied ? "success" : "incomplete"} label="source-applied" testId="harness-applied-state" />
      <StatusBadge kind={released ? "success" : "incomplete"} label="release" testId="harness-release-state" />
    </div>
    <p data-testid="harness-written-planned" data-written={written} data-planned={planned}>written {written} / planned {planned}</p>
    {validation === null ? <StatusBadge kind="incomplete" label="validation-pending" testId="harness-validation-pending" /> : <ul>
      <li data-testid="harness-check-schema" data-ok={String(validation.schema)}><StatusBadge kind={checkTone(validation.schema)} label="schema" testId="harness-schema" /></li>
      <li data-testid="harness-check-graph" data-ok={String(validation.graph)}><StatusBadge kind={checkTone(validation.graph)} label="graph" testId="harness-graph" /></li>
      <li data-testid="harness-check-assets" data-ok={String(validation.assets)}><StatusBadge kind={checkTone(validation.assets)} label="assets" testId="harness-assets" /></li>
      <li data-testid="harness-check-runtime" data-ok={String(validation.runtime)}><StatusBadge kind={checkTone(validation.runtime)} label="runtime" testId="harness-runtime" /></li>
    </ul>}
    {missing.length > 0 ? <StatusBadge kind="error" label="required-assets-missing" testId="harness-missing-assets" /> : null}
  </section>;
}
