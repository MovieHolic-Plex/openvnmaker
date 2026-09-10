import { parseScript, type VnScript } from "@vnmaker/content";
import {
  assertNever, canonicalHash, hashSchema, parseDecisionReceipt, parseProductionDocument, parseProjectHead, parseProposal,
  type DecisionReceipt, type HarnessErrorCode, type ProductionDocument, type ProjectHead, type Proposal, type Sha256,
} from "@vnmaker/harness";
import { storeAssets, type StoredAsset } from "../../storage/projectAssets.js";
import { listProposalDecisions, sameHead, type StoredDecision } from "../projects.js";
import type { ProjectCommit, ProjectRepository, ProjectSnapshot } from "../projectRepository.js";

export { canonicalHash, parseDecisionReceipt, parseProductionDocument, parseProjectHead, parseProposal };
export const APPLY_EVENT = "vnmaker:harness-apply";

export type PreparedProposalAsset = {
  readonly hash: Sha256;
  readonly bytes: Uint8Array;
  readonly originalName: string;
};
export type ReviewedProposalApplication = {
  readonly proposal: Proposal;
  readonly script: VnScript;
  readonly productionDocument: ProductionDocument;
  readonly contextHead: ProjectHead;
  readonly assets: readonly PreparedProposalAsset[];
};
export type ExistingDecisionAction =
  | { readonly action: "proceed" }
  | { readonly action: "return-existing"; readonly receipt: DecisionReceipt }
  | { readonly action: "conflict"; readonly code: "ID_PAYLOAD_CONFLICT" | "DECISION_CONFLICT" };
export type ApplyProposalFailure = {
  readonly ok: false;
  readonly code: Extract<HarnessErrorCode, "ID_PAYLOAD_CONFLICT" | "DECISION_CONFLICT" | "STALE_HEAD" | "INVALID_INPUT" | "REVIEW_REQUIRED">;
};
export type ApplyProposalResult = { readonly ok: true; readonly receipt: DecisionReceipt; readonly duplicate: boolean } | ApplyProposalFailure;
type ApplyKind = "applied" | "rejected";
export type ApplyRepository = {
  readonly snapshot: ProjectSnapshot;
  readonly current: { readonly generation: AbortSignal };
  flushCurrent(): Promise<ProjectSnapshot>;
  commit(input: ProjectCommit): Promise<ProjectSnapshot>;
  readDecision(proposalId: string): Promise<StoredDecision | null>;
  rejectDecision(receipt: DecisionReceipt): Promise<void>;
  markDecisionAcked(proposalId: string): Promise<void>;
};
export type ApplyProposalInput = {
  readonly repository: ApplyRepository;
  readonly application: ReviewedProposalApplication;
  readonly kind: ApplyKind;
  readonly receiptId: string;
  readonly createdAt: string;
  readonly publish: (snapshot: ProjectSnapshot, receipt: DecisionReceipt) => void | Promise<void>;
  readonly ack: (receipt: DecisionReceipt) => Promise<void>;
};

export function classifyExistingDecision(existing: DecisionReceipt | null, proposal: Proposal, kind: ApplyKind): ExistingDecisionAction {
  switch (kind) {
    case "applied": case "rejected": break;
    default: return assertNever(kind);
  }
  if (existing === null) return { action: "proceed" };
  if (existing.proposalDigest !== proposal.digest) return { action: "conflict", code: "ID_PAYLOAD_CONFLICT" };
  if (existing.kind !== kind) return { action: "conflict", code: "DECISION_CONFLICT" };
  return { action: "return-existing", receipt: existing };
}
export function classifyAuthority(proposal: Proposal, head: ProjectHead): "ok" | "STALE_HEAD" {
  return proposal.baseHead.projectId === head.projectId && proposal.baseHead.lineageId === head.lineageId ? "ok" : "STALE_HEAD";
}
export function classifyApplyHeads(proposal: Proposal, contextHead: ProjectHead, flushed: ProjectHead): "ok" | "STALE_HEAD" {
  return sameHead(proposal.baseHead, flushed) && sameHead(contextHead, flushed) ? "ok" : "STALE_HEAD";
}

type ApplyPhase = "committed" | "published" | "duplicate" | "failed" | "ack-pending" | "acked";
function emitApply(phase: ApplyPhase, payload: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APPLY_EVENT, { detail: { phase, payload } }));
}

type AfterCommitBarrier = { readonly notifyArrived: () => void; readonly held: Promise<void> };
let afterCommitBarrier: AfterCommitBarrier | null = null;
export function armAfterCommitBarrier(): { readonly arrived: Promise<void>; readonly release: () => void } {
  afterCommitBarrier?.notifyArrived();
  let notifyArrived = (): void => {};
  const arrived = new Promise<void>(resolve => { notifyArrived = resolve; });
  let releaseHeld = (): void => {};
  const held = new Promise<void>(resolve => { releaseHeld = resolve; });
  afterCommitBarrier = { notifyArrived, held };
  return {
    arrived,
    release: () => {
      releaseHeld();
      if (afterCommitBarrier?.held === held) afterCommitBarrier = null;
    },
  };
}
async function waitAfterCommit(): Promise<void> {
  const barrier = afterCommitBarrier;
  if (barrier === null) return;
  barrier.notifyArrived();
  await barrier.held;
}

let staged: ReviewedProposalApplication | null = null;
const stagedListeners = new Set<() => void>();
export function stageReviewedProposal(application: ReviewedProposalApplication): void {
  staged = application;
  for (const listener of stagedListeners) listener();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vnmaker:proposal-staged", { detail: { proposalId: application.proposal.id } }));
  }
}
export function getStagedProposal(): ReviewedProposalApplication | null { return staged; }
export function subscribeStagedProposal(listener: () => void): () => void {
  stagedListeners.add(listener);
  return () => { stagedListeners.delete(listener); };
}

export async function recoverAcceptedHead(repository: ProjectRepository, mirror: VnScript): Promise<boolean> {
  const snapshot = repository.snapshot;
  if (await canonicalHash(mirror) === snapshot.head.scriptHash) return false;
  for (const row of await listProposalDecisions(snapshot.head.projectId)) {
    if (row.receipt.kind !== "applied") continue;
    if (row.receipt.lineageId !== snapshot.head.lineageId) continue;
    if (sameHead(row.receipt.resultHead, snapshot.head)) return true;
  }
  return false;
}

async function prepareAssets(required: readonly Sha256[], assets: readonly PreparedProposalAsset[]): Promise<ApplyProposalFailure | null> {
  if (required.length === 0) return null;
  const byHash = new Map(assets.map(asset => [asset.hash, asset]));
  const stored: StoredAsset[] = [];
  for (const hash of required) {
    const asset = byHash.get(hash);
    if (asset === undefined) return { ok: false, code: "INVALID_INPUT" };
    const copy = new Uint8Array(asset.bytes.byteLength);
    copy.set(asset.bytes);
    const digest = hashSchema.parse(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), byte => byte.toString(16).padStart(2, "0")).join(""));
    if (digest !== hash) return { ok: false, code: "INVALID_INPUT" };
    stored.push({ path: `/assets/user/${hash}`, blob: new Blob([copy]), originalName: asset.originalName, createdAt: Date.now() });
  }
  await storeAssets(stored);
  return null;
}

async function tryAck(stored: StoredDecision, ack: (receipt: DecisionReceipt) => Promise<void>, repository: ApplyRepository): Promise<void> {
  if (stored.ackStatus === "acked") { emitApply("acked", stored.receipt); return; }
  try {
    await ack(stored.receipt);
    await repository.markDecisionAcked(stored.proposalId);
    emitApply("acked", stored.receipt);
  } catch { emitApply("ack-pending", stored.receipt); }
}

function fail(code: ApplyProposalFailure["code"]): ApplyProposalFailure {
  emitApply("failed", { code });
  return { ok: false, code };
}

export async function applyProposal(input: ApplyProposalInput): Promise<ApplyProposalResult> {
  const proposal = parseProposal(input.application.proposal);
  const existing = await input.repository.readDecision(proposal.id);
  const classified = classifyExistingDecision(existing === null ? null : existing.receipt, proposal, input.kind);
  switch (classified.action) {
    case "conflict": return fail(classified.code);
    case "return-existing":
      emitApply("duplicate", classified.receipt);
      if (existing !== null) await tryAck(existing, input.ack, input.repository);
      return { ok: true, receipt: classified.receipt, duplicate: true };
    case "proceed": break;
    default: return assertNever(classified);
  }
  if (classifyAuthority(proposal, input.repository.snapshot.head) !== "ok") return fail("STALE_HEAD");
  switch (input.kind) {
    case "rejected": return rejectProposal(input, proposal);
    case "applied": return acceptProposal(input, proposal);
    default: return assertNever(input.kind);
  }
}

async function rejectProposal(input: ApplyProposalInput, proposal: Proposal): Promise<ApplyProposalResult> {
  const receipt = parseDecisionReceipt({
    receiptId: input.receiptId, projectId: proposal.baseHead.projectId, lineageId: proposal.baseHead.lineageId,
    proposalId: proposal.id, proposalDigest: proposal.digest, kind: "rejected", baseHead: proposal.baseHead,
    resultHead: null, createdAt: input.createdAt,
  });
  await input.repository.rejectDecision(receipt);
  const stored = await input.repository.readDecision(proposal.id);
  if (stored === null) return fail("INVALID_INPUT");
  emitApply("committed", stored.receipt);
  await waitAfterCommit();
  emitApply("published", stored.receipt);
  await tryAck(stored, input.ack, input.repository);
  return { ok: true, receipt: stored.receipt, duplicate: false };
}

async function acceptProposal(input: ApplyProposalInput, proposal: Proposal): Promise<ApplyProposalResult> {
  const report = proposal.validation;
  if (!(report.schema && report.graph && report.assets && report.runtime && report.requiredAssetsMissing.length === 0)) {
    return fail("REVIEW_REQUIRED");
  }
  const script = parseScript(input.application.script);
  const productionDocument = parseProductionDocument(input.application.productionDocument);
  const flushed = await input.repository.flushCurrent();
  if (classifyApplyHeads(proposal, input.application.contextHead, flushed.head) !== "ok") return fail("STALE_HEAD");
  const prepared = await prepareAssets(proposal.requiredAssetHashes, input.application.assets);
  if (prepared !== null) return prepared;
  let snapshot: ProjectSnapshot;
  try {
    snapshot = await input.repository.commit({
      generation: input.repository.current.generation, expectedHead: flushed.head, script, productionDocument,
      appliedDecision: {
        receiptId: input.receiptId, proposalId: proposal.id, proposalDigest: proposal.digest, createdAt: input.createdAt,
      },
    });
  } catch (error) {
    emitApply("failed", { name: error instanceof Error ? error.name : "write" });
    throw error;
  }
  const stored = await input.repository.readDecision(proposal.id);
  if (stored === null || stored.receipt.kind !== "applied") return fail("INVALID_INPUT");
  emitApply("committed", stored.receipt);
  await waitAfterCommit();
  await input.publish(snapshot, stored.receipt);
  emitApply("published", stored.receipt);
  await tryAck(stored, input.ack, input.repository);
  return { ok: true, receipt: stored.receipt, duplicate: false };
}
