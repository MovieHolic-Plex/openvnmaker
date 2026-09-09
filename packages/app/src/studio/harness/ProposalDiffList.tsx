import { useMemo, useState } from "react";
import type { VnScript } from "@vnmaker/content";
import { DIFF_ROW_HEIGHT, DIFF_VIEWPORT, listWindow, windowSlice } from "./listWindow.js";
import { collectProposalDiffWork } from "./proposalDiff.js";

export type { ProposalDiffRow } from "./proposalDiff.js";
export { collectProposalDiffs, collectProposalDiffWork } from "./proposalDiff.js";

export function ProposalDiffList({ source, candidate }: { readonly source: VnScript; readonly candidate: VnScript }) {
  const work = useMemo(() => collectProposalDiffWork(source, candidate), [source, candidate]);
  const rows = work.rows;
  const [scrollTop, setScrollTop] = useState(0);
  const frame = listWindow({
    total: rows.length, scrollTop, viewportHeight: DIFF_VIEWPORT, rowHeight: DIFF_ROW_HEIGHT,
  });
  const visible = windowSlice(rows, frame);
  return <section className="harness-diffs" data-testid="harness-diff-list" data-count={rows.length}
    data-copied={work.linesCopied} data-cloned={String(work.clonedWholeScript)} data-scenes={work.scenesCopied}>
    <h3>후보 변경</h3>
    {rows.length === 0 ? <p data-testid="harness-diff-empty">후보와 원본이 같습니다</p> : <div
      className="harness-window" data-testid="harness-diff-window"
      data-start={frame.start} data-end={frame.end} data-visible={frame.visible} data-total={frame.total}
      data-row-height={DIFF_ROW_HEIGHT}
      style={{ height: Math.min(DIFF_VIEWPORT, rows.length * DIFF_ROW_HEIGHT) }}
      onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="harness-window-pad" style={{ height: frame.padTop }} />
      <ul>{visible.map(row => <li key={`${row.field}-${row.id}`} data-testid={`harness-diff-${row.field}-${row.id}`}
        data-scope={row.scope} style={{ height: DIFF_ROW_HEIGHT }}>
        <strong>{row.field}</strong>
        <span data-scope="source">{row.before}</span>
        <span data-scope="candidate">{row.after}</span>
      </li>)}</ul>
      <div className="harness-window-pad" style={{ height: frame.padBottom }} />
    </div>}
  </section>;
}
