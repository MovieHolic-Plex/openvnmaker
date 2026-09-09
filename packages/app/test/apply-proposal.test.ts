import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript } from "@vnmaker/content";
import {
  canonicalHash, parseDecisionReceipt, parseProductionDocument, parseProjectHead, parseProposal,
} from "@vnmaker/harness";
import { historyReducer } from "../src/studio/project.js";
import {
  classifyApplyHeads, classifyAuthority, classifyExistingDecision,
} from "../src/studio/harness/applyProposal.js";

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
  schema: true, graph: true, assets: true, runtime: true,
  requiredAssetsMissing: [], issues: [], reviewIds: [],
};

async function fixtureProposal(digest?: string) {
  const body = {
    id: UUID.proposal, runId: UUID.run, baseHead: head, operations: [],
    requiredAssetHashes: [], contextManifestHash: await canonicalHash("fixture-context"), validation,
  };
  return parseProposal({ ...body, digest: digest ?? await canonicalHash(body) });
}

function appliedReceipt(proposal: Awaited<ReturnType<typeof fixtureProposal>>, resultRevision: number) {
  return parseDecisionReceipt({
    receiptId: UUID.receipt, projectId: head.projectId, lineageId: head.lineageId, proposalId: proposal.id,
    proposalDigest: proposal.digest, kind: "applied", baseHead: head,
    resultHead: { ...head, revision: resultRevision }, createdAt: "2026-09-09T00:00:00.000Z",
  });
}

test("classifyExistingDecision returns the stored receipt before a stale base is considered", async () => {
  // Given an applied receipt for this proposal id and digest.
  const proposal = await fixtureProposal();
  const receipt = appliedReceipt(proposal, 1);
  // When the same decision is redelivered.
  const outcome = classifyExistingDecision(receipt, proposal, "applied");
  // Then the existing receipt is returned unchanged.
  assert.deepEqual(outcome, { action: "return-existing", receipt });
  assert.equal(outcome.action === "return-existing" ? outcome.receipt.receiptId : "", UUID.receipt);
});

test("classifyExistingDecision treats a different digest as ID_PAYLOAD_CONFLICT", async () => {
  // Given a stored receipt whose digest does not match the redelivered proposal.
  const proposal = await fixtureProposal();
  const other = await fixtureProposal("b".repeat(64));
  const receipt = appliedReceipt(proposal, 1);
  // When the same id arrives with another digest.
  const outcome = classifyExistingDecision(receipt, other, "applied");
  // Then the conflict is 409 ID_PAYLOAD_CONFLICT, not a new head.
  assert.deepEqual(outcome, { action: "conflict", code: "ID_PAYLOAD_CONFLICT" });
});

test("classifyExistingDecision treats an opposite kind as DECISION_CONFLICT", async () => {
  // Given an applied receipt.
  const proposal = await fixtureProposal();
  const receipt = appliedReceipt(proposal, 1);
  // When a reject is attempted for the same proposal.
  const outcome = classifyExistingDecision(receipt, proposal, "rejected");
  // Then the stored receipt is not rewritten.
  assert.deepEqual(outcome, { action: "conflict", code: "DECISION_CONFLICT" });
});

test("classifyExistingDecision does not invent a new receipt after undo", async () => {
  // Given the original applied receipt after the UI has undone the manuscript.
  const proposal = await fixtureProposal();
  const receipt = appliedReceipt(proposal, 1);
  // When apply is redelivered.
  const duplicate = classifyExistingDecision(receipt, proposal, "applied");
  const proceed = classifyExistingDecision(null, proposal, "applied");
  // Then only a missing receipt may proceed to a new head approval.
  assert.equal(duplicate.action, "return-existing");
  assert.equal(proceed.action, "proceed");
});

test("classifyApplyHeads conflicts when only the canon hash changed", async () => {
  // Given a flushed head whose production hash moved and whose script hash did not.
  const proposal = await fixtureProposal();
  const canonHead = parseProjectHead({ ...head, productionHash: "c".repeat(64) });
  // When apply compares base and context heads.
  const outcome = classifyApplyHeads(proposal, canonHead, canonHead);
  // Then a canon-only source change is still STALE_HEAD.
  assert.equal(outcome, "STALE_HEAD");
});

test("classifyApplyHeads accepts when base, context, and flushed heads match", async () => {
  // Given an unchanged source head.
  const proposal = await fixtureProposal();
  // When every authority field matches.
  const outcome = classifyApplyHeads(proposal, head, head);
  // Then apply may proceed to asset prepare and commit.
  assert.equal(outcome, "ok");
});

test("classifyAuthority rejects a proposal from another lineage", async () => {
  // Given a proposal bound to the original lineage.
  const proposal = await fixtureProposal();
  const imported = parseProjectHead({ ...head, lineageId: "00000000-0000-4000-8000-000000000099" });
  // When the current repository lineage is a new import identity.
  const outcome = classifyAuthority(proposal, imported);
  // Then the old proposal cannot approve a new head.
  assert.equal(outcome, "STALE_HEAD");
});

test("historyReducer apply records exactly one undo group that undo restores", () => {
  // Given a source manuscript with empty history.
  const applied = { ...script, title: "Applied manuscript" };
  const initial = { past: [], present: script, future: [] };
  // When one apply is published after the durable commit.
  const state = historyReducer(initial, { type: "apply", script: applied, receiptId: UUID.receipt });
  const grouped = historyReducer(state, { type: "apply", script: { ...applied, subtitle: "again" }, receiptId: UUID.receipt });
  const undone = historyReducer(state, { type: "undo" });
  // Then apply never coalesces and a single undo restores the source.
  assert.equal(state.past.length, 1);
  assert.equal(state.present.title, "Applied manuscript");
  assert.equal(state.group, `apply:${UUID.receipt}`);
  assert.equal(grouped.past.length, 2);
  assert.equal(undone.present, script);
  assert.equal(undone.future.length, 1);
});
