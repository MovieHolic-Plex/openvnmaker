import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript, type VnScript } from "@vnmaker/content";
import {
  canonicalHash, parseDecisionReceipt, parseProductionDocument, parseProjectHead, parseProposal,
} from "@vnmaker/harness";
import {
  applyProposal, armAfterCommitBarrier, classifyAuthority,
  type ApplyRepository, type ReviewedProposalApplication,
} from "../src/studio/harness/applyProposal.js";
import { archivedReceiptAuthority, authoringRunDisposition } from "../src/studio/harness/authoringArchive.js";
import type { ProjectCommit, ProjectSnapshot } from "../src/studio/projectRepository.js";
import type { StoredDecision } from "../src/studio/projects.js";

const UUID = {
  lineage: "00000000-0000-4000-8000-000000000001",
  run: "00000000-0000-4000-8000-000000000002",
  proposal: "00000000-0000-4000-8000-000000000003",
  receipt: "00000000-0000-4000-8000-000000000004",
} as const;
const script = parseScript({
  title: "Source", subtitle: "", start: "start", characters: [],
  scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Original" }], ending: "End" }],
});
const productionDocument = parseProductionDocument({
  version: 1, brief: "", castCanon: [], worldTimeline: [], branchFacts: [],
  outline: { title: "Source", subtitle: "", bible: "", start: "start", scenes: [] },
  artDirection: [], referenceBindings: [],
});
const head = parseProjectHead({
  projectId: "legacy", lineageId: UUID.lineage, revision: 0,
  scriptHash: await canonicalHash(script), productionHash: await canonicalHash(productionDocument),
});
const validation = {
  schema: true, graph: true, assets: true, runtime: true, requiredAssetsMissing: [] as const, issues: [] as const, reviewIds: [] as const,
};

class MemoryApplyRepository implements ApplyRepository {
  snapshot: ProjectSnapshot;
  readonly current: { readonly generation: AbortSignal };
  sourceCommits = 0;
  flushes = 0;
  queued: { readonly script: VnScript; readonly productionDocument: typeof productionDocument } | null = null;
  private readonly generation = new AbortController();
  private readonly decisions = new Map<string, StoredDecision>();
  constructor(snapshot: ProjectSnapshot) {
    this.snapshot = snapshot;
    this.current = { generation: this.generation.signal };
  }
  async flushCurrent(): Promise<ProjectSnapshot> {
    this.flushes += 1;
    if (this.queued !== null) {
      const revision = this.snapshot.head.revision + 1;
      const [scriptHash, productionHash] = await Promise.all([
        canonicalHash(this.queued.script), canonicalHash(this.queued.productionDocument),
      ]);
      this.snapshot = {
        head: parseProjectHead({ ...this.snapshot.head, revision, scriptHash, productionHash }),
        script: this.queued.script, productionDocument: this.queued.productionDocument,
      };
      this.queued = null;
    }
    return this.snapshot;
  }
  async commit(input: ProjectCommit): Promise<ProjectSnapshot> {
    this.sourceCommits += 1;
    const revision = this.snapshot.head.revision + 1;
    const [scriptHash, productionHash] = await Promise.all([canonicalHash(input.script), canonicalHash(input.productionDocument)]);
    const nextHead = parseProjectHead({ ...input.expectedHead, revision, scriptHash, productionHash });
    if (input.appliedDecision !== undefined) {
      const receipt = parseDecisionReceipt({
        receiptId: input.appliedDecision.receiptId, projectId: nextHead.projectId, lineageId: nextHead.lineageId,
        proposalId: input.appliedDecision.proposalId, proposalDigest: input.appliedDecision.proposalDigest,
        kind: "applied", baseHead: input.expectedHead, resultHead: nextHead, createdAt: input.appliedDecision.createdAt,
      });
      this.decisions.set(input.appliedDecision.proposalId, {
        projectId: nextHead.projectId, lineageId: nextHead.lineageId, proposalId: input.appliedDecision.proposalId,
        ackStatus: "pending", receipt,
      });
    }
    this.snapshot = { head: nextHead, script: input.script, productionDocument: input.productionDocument };
    return this.snapshot;
  }
  async readDecision(proposalId: string): Promise<StoredDecision | null> {
    return this.decisions.get(proposalId) ?? null;
  }
  async rejectDecision(receipt: ReturnType<typeof parseDecisionReceipt>): Promise<void> {
    this.decisions.set(receipt.proposalId, {
      projectId: receipt.projectId, lineageId: receipt.lineageId, proposalId: receipt.proposalId, ackStatus: "pending", receipt,
    });
  }
  async markDecisionAcked(proposalId: string): Promise<void> {
    const existing = this.decisions.get(proposalId);
    if (existing === undefined) return;
    this.decisions.set(proposalId, { ...existing, ackStatus: "acked" });
  }
}

async function application(next: VnScript, contextHead = head): Promise<ReviewedProposalApplication> {
  const body = {
    id: UUID.proposal, runId: UUID.run, baseHead: head, operations: [],
    requiredAssetHashes: [], contextManifestHash: await canonicalHash("fixture-context"), validation,
  };
  return {
    proposal: parseProposal({ ...body, digest: await canonicalHash(body) }),
    script: next, productionDocument, contextHead, assets: [],
  };
}

test("queued-save/apply", async () => {
  const repository = new MemoryApplyRepository({ head, script, productionDocument });
  const applied = parseScript({ ...script, title: "Applied manuscript" });
  const result = await applyProposal({
    repository, application: await application(applied), kind: "applied",
    receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => undefined, ack: async () => undefined,
  });
  assert.equal(result.ok, true);
  assert.equal(repository.flushes, 1);
  assert.equal(repository.sourceCommits, 1);
  assert.equal(repository.snapshot.head.revision, 1);
});

test("queued-save/apply stale after flush", async () => {
  const repository = new MemoryApplyRepository({ head, script, productionDocument });
  repository.queued = { script: parseScript({ ...script, title: "Human edit" }), productionDocument };
  const result = await applyProposal({
    repository, application: await application(parseScript({ ...script, title: "Applied manuscript" })),
    kind: "applied", receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => undefined, ack: async () => undefined,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "STALE_HEAD");
  assert.equal(repository.flushes, 1);
  assert.equal(repository.sourceCommits, 0);
  assert.equal(repository.snapshot.script.title, "Human edit");
});

test("commit-before-UI crash", async () => {
  const repository = new MemoryApplyRepository({ head, script, productionDocument });
  const barrier = armAfterCommitBarrier();
  let uiLive = true;
  let publishes = 0;
  const pending = applyProposal({
    repository, application: await application(parseScript({ ...script, title: "Applied manuscript" })),
    kind: "applied", receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => { if (uiLive) publishes += 1; }, ack: async () => undefined,
  });
  await barrier.arrived;
  assert.equal(repository.sourceCommits, 1);
  assert.equal(publishes, 0);
  uiLive = false;
  barrier.release();
  const first = await pending;
  assert.equal(first.ok, true);
  assert.equal(publishes, 0);
  const again = await applyProposal({
    repository, application: await application(parseScript({ ...script, title: "Applied manuscript" })),
    kind: "applied", receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => { publishes += 1; }, ack: async () => undefined,
  });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.duplicate, true);
  assert.equal(repository.sourceCommits, 1);
  assert.equal(publishes, 0);
});

test("duplicate-after-undo", async () => {
  const repository = new MemoryApplyRepository({ head, script, productionDocument });
  const applied = parseScript({ ...script, title: "Applied manuscript" });
  const first = await applyProposal({
    repository, application: await application(applied), kind: "applied",
    receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => undefined, ack: async () => undefined,
  });
  assert.equal(first.ok, true);
  repository.snapshot = { ...repository.snapshot, script };
  const second = await applyProposal({
    repository, application: await application(applied), kind: "applied",
    receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => undefined, ack: async () => undefined,
  });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.duplicate, true);
  assert.equal(repository.sourceCommits, 1);
  assert.equal(repository.snapshot.script.title, "Source");
});

test("r2-reject-accept-race", async () => {
  const repository = new MemoryApplyRepository({ head, script, productionDocument });
  const reviewed = await application(parseScript({ ...script, title: "Candidate" }));
  const rejected = await applyProposal({
    repository, application: reviewed, kind: "rejected",
    receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => undefined, ack: async () => undefined,
  });
  assert.equal(rejected.ok, true);
  const accepted = await applyProposal({
    repository, application: reviewed, kind: "applied",
    receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => undefined, ack: async () => undefined,
  });
  assert.equal(accepted.ok, false);
  if (accepted.ok) return;
  assert.equal(accepted.code, "DECISION_CONFLICT");
  assert.equal(repository.sourceCommits, 0);
});

test("restored lineage", async () => {
  const restored = parseProjectHead({ ...head, projectId: "restored-work", lineageId: "00000000-0000-4000-8000-000000000099" });
  const repository = new MemoryApplyRepository({ head: restored, script, productionDocument });
  const reviewed = await application(parseScript({ ...script, title: "Old proposal" }));
  const result = await applyProposal({
    repository, application: reviewed, kind: "applied",
    receiptId: UUID.receipt, createdAt: "2026-09-09T00:00:00.000Z",
    publish: () => undefined, ack: async () => undefined,
  });
  assert.equal(classifyAuthority(reviewed.proposal, restored), "STALE_HEAD");
  assert.equal(archivedReceiptAuthority(reviewed.proposal.baseHead, restored), "reference");
  assert.equal(authoringRunDisposition({ kind: "imported-draft" }, true).autoResume, false);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "STALE_HEAD");
  assert.equal(repository.sourceCommits, 0);
});
