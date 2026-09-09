import type { VnScript } from "@vnmaker/content";

export type ProposalDiffRow = {
  readonly id: string;
  readonly scope: "source" | "candidate";
  readonly field: string;
  readonly before: string;
  readonly after: string;
};

export function collectProposalDiffs(source: VnScript, candidate: VnScript): readonly ProposalDiffRow[] {
  const rows: ProposalDiffRow[] = [];
  if (source.title !== candidate.title) {
    rows.push({ id: "title", scope: "candidate", field: "title", before: source.title, after: candidate.title });
  }
  const sourceIds = new Set(source.scenes.map(scene => scene.id));
  const candidateIds = new Set(candidate.scenes.map(scene => scene.id));
  for (const scene of candidate.scenes) {
    if (!sourceIds.has(scene.id)) {
      rows.push({ id: scene.id, scope: "candidate", field: "scene", before: "", after: scene.id });
      continue;
    }
    const previous = source.scenes.find(row => row.id === scene.id);
    const before = previous?.lines.map(line => line.text).join("\n") ?? "";
    const after = scene.lines.map(line => line.text).join("\n");
    if (before !== after) rows.push({ id: scene.id, scope: "candidate", field: "lines", before, after });
  }
  for (const scene of source.scenes) {
    if (!candidateIds.has(scene.id)) rows.push({ id: scene.id, scope: "source", field: "scene", before: scene.id, after: "" });
  }
  return rows;
}

export function ProposalDiffList({ source, candidate }: { readonly source: VnScript; readonly candidate: VnScript }) {
  const rows = collectProposalDiffs(source, candidate);
  return <section className="harness-diffs" data-testid="harness-diff-list" data-count={rows.length}>
    <h3>후보 변경</h3>
    {rows.length === 0 ? <p data-testid="harness-diff-empty">후보와 원본이 같습니다</p> : <ul>
      {rows.map(row => <li key={`${row.field}-${row.id}`} data-testid={`harness-diff-${row.field}-${row.id}`} data-scope={row.scope}>
        <strong>{row.field}</strong>
        <span data-scope="source">{row.before}</span>
        <span data-scope="candidate">{row.after}</span>
      </li>)}
    </ul>}
  </section>;
}
