import type { VnScript } from "@vnmaker/content";
import { canonicalHash, parseProposal, type ReuseAnalysis, type ValidationReport } from "@vnmaker/harness";
import type { ProjectRepository } from "../projectRepository.js";
import { stageReviewedProposal } from "./applyProposal.js";
import { getCandidateWorkspace } from "./candidateStore.js";
import { ProposalDiffList } from "./ProposalDiffList.js";
import { QualityReport } from "./QualityReport.js";
import { ReuseReview } from "./ReuseReview.js";

export function candidateValidation(candidate: VnScript, planned: readonly string[]): ValidationReport {
  const written = new Set(candidate.scenes.map(scene => scene.id));
  const closed = planned.every(id => written.has(id));
  return {
    schema: true, graph: closed, assets: true, runtime: closed,
    requiredAssetsMissing: [], issues: [], reviewIds: [],
  };
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
  const validation = candidateValidation(candidate, planned);
  const ready = validation.schema && validation.graph && validation.assets && validation.runtime;
  async function stageApply(): Promise<void> {
    const workspace = getCandidateWorkspace();
    if (repository === null || workspace === null || !ready) return;
    const body = {
      id: crypto.randomUUID(), runId: workspace.runId, baseHead: repository.snapshot.head, operations: [],
      requiredAssetHashes: [], contextManifestHash: await canonicalHash("workspace-context"), validation,
    };
    stageReviewedProposal({
      proposal: parseProposal({ ...body, digest: await canonicalHash(body) }),
      script: workspace.script, productionDocument: workspace.productionDocument,
      contextHead: repository.snapshot.head, assets: [],
    });
  }
  return <section className="harness-review" data-testid="harness-proposal-review">
    <QualityReport
      validation={validation} previewEligible={candidate.scenes.length > 0} proposalReady={ready}
      applied={applied} released={false} written={candidate.scenes.length} planned={planned.length}
    />
    <ProposalDiffList source={source} candidate={candidate} />
    <ReuseReview analysis={analysis} busy={busy} onRepropose={onRepropose} />
    <button type="button" className="studio-button primary" data-testid="harness-stage-apply" disabled={!ready || repository === null} onClick={() => void stageApply()}>
      원본 적용 준비
    </button>
  </section>;
}
