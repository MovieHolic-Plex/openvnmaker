import type { VnScript } from "@vnmaker/content";
import {
  canonicalHash, parseProductionDocument, parseProposal, validateWorkspace,
  type ProductionDocument, type ReuseAnalysis, type WorkspaceValidationReport,
} from "@vnmaker/harness";
import { useState } from "react";
import type { ProjectRepository } from "../projectRepository.js";
import { stageReviewedProposal } from "./applyProposal.js";
import { getCandidateWorkspace } from "./candidateStore.js";
import { ProposalDiffList } from "./ProposalDiffList.js";
import { QualityReport } from "./QualityReport.js";
import { ReuseReview } from "./ReuseReview.js";

function fallbackDocument(candidate: VnScript, planned: readonly string[]): ProductionDocument {
  return parseProductionDocument({
    version: 1, brief: "", castCanon: [], worldTimeline: [], branchFacts: [],
    outline: {
      title: candidate.title, subtitle: candidate.subtitle, bible: "", start: candidate.start,
      scenes: planned.map(id => ({
        id, chapter: "1", title: id, summary: id, artDirection: "pending",
        targetMinutes: 1, background: "title",
      })),
    },
    artDirection: [], referenceBindings: [],
  });
}

export function workspaceReport(candidate: VnScript, planned: readonly string[], approvals: readonly string[] = []): WorkspaceValidationReport {
  const workspace = getCandidateWorkspace();
  return validateWorkspace({
    script: candidate,
    productionDocument: workspace?.productionDocument ?? fallbackDocument(candidate, planned),
    reviews: [], requiredAssetHashes: [], presentAssetHashes: [], assetInspections: [],
    plannedSceneIds: planned, chapterApprovals: approvals, quota: null,
  });
}

export function ProposalReview({
  repository, source, candidate, planned, analysis, busy, applied, onRepropose,
}: {
  readonly repository: ProjectRepository | null;
  readonly source: VnScript;
  readonly candidate: VnScript;
  readonly planned: readonly string[];
  readonly analysis: ReuseAnalysis | null;
  readonly busy: boolean;
  readonly applied: boolean;
  readonly onRepropose: () => void;
}) {
  const [approvals, setApprovals] = useState<readonly string[]>([]);
  const report = workspaceReport(candidate, planned, approvals);
  const ready = report.gate.proposalReady;
  async function stageApply(): Promise<void> {
    const workspace = getCandidateWorkspace();
    if (repository === null || workspace === null || !ready) return;
    const body = {
      id: crypto.randomUUID(), runId: workspace.runId, baseHead: repository.snapshot.head, operations: [],
      requiredAssetHashes: [], contextManifestHash: await canonicalHash("workspace-context"),
      validation: report.compact,
    };
    stageReviewedProposal({
      proposal: parseProposal({ ...body, digest: await canonicalHash(body) }),
      script: workspace.script, productionDocument: workspace.productionDocument,
      contextHead: repository.snapshot.head, assets: [],
    });
  }
  return <section className="harness-review" data-testid="harness-proposal-review">
    <QualityReport
      report={report} applied={applied} released={false}
      onApproveChapter={id => setApprovals(current => current.includes(id) ? current : [...current, id])}
    />
    <ProposalDiffList source={source} candidate={candidate} />
    <ReuseReview analysis={analysis} busy={busy} onRepropose={onRepropose} />
    <button type="button" className="studio-button primary" data-testid="harness-stage-apply" disabled={!ready || repository === null} onClick={() => void stageApply()}>
      원본 적용 준비
    </button>
  </section>;
}
