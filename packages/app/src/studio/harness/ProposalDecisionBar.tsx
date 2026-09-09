import type { VnScript } from "@vnmaker/content";
import { useState, useSyncExternalStore } from "react";
import { ackHarnessDecision } from "../../api/harness.js";
import type { ProjectRepository } from "../projectRepository.js";
import { applyProposal, getStagedProposal, subscribeStagedProposal } from "./applyProposal.js";

export function ProposalDecisionBar({
  repository, onPublish, onNotice,
}: {
  readonly repository: ProjectRepository | null;
  readonly onPublish: (script: VnScript, receiptId: string) => void;
  readonly onNotice: (message: string) => void;
}) {
  const application = useSyncExternalStore(subscribeStagedProposal, getStagedProposal, getStagedProposal);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (application === null) return null;
  const reviewed = application;
  async function decide(decision: "applied" | "rejected"): Promise<void> {
    if (repository === null || busy) return;
    setBusy(true);
    try {
      const result = await applyProposal({
        repository, application: reviewed, kind: decision, receiptId: crypto.randomUUID(), createdAt: new Date().toISOString(),
        publish: (snapshot, receipt) => { onPublish(snapshot.script, receipt.receiptId); },
        ack: async receipt => { await ackHarnessDecision(reviewed.proposal.runId, receipt.kind, receipt); },
      });
      if (!result.ok) { onNotice(result.code); return; }
      setReceiptId(result.receipt.receiptId);
      setKind(result.receipt.kind);
      if (result.duplicate) onNotice("기존 결정 영수증을 반환했습니다.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }
  return <div className="harness-proposal-bar" data-testid="harness-proposal-bar">
    <button type="button" className="studio-button primary" data-testid="harness-apply" disabled={busy || repository === null} onClick={() => void decide("applied")}>원본에 적용</button>
    <button type="button" className="studio-button" data-testid="harness-reject" disabled={busy || repository === null} onClick={() => void decide("rejected")}>후보 거절</button>
    {receiptId !== null && kind !== null ? <span data-testid="harness-decision-receipt" data-kind={kind}>{receiptId}</span> : null}
  </div>;
}
