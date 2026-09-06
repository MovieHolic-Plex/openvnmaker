import assert from "node:assert/strict";
import { admitBudget, canonicalHash, createRunCommandSchema, DEFAULT_BUDGET_LIMITS, HarnessError,
  parseBudgetRequest, parsePreviewSnapshot, parseSnapshotJson, parseToolEnvelope } from "@vnmaker/harness";

const uuid = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const envelope = {
  callId: uuid, candidateId: uuid, expectedCandidateRevision: 4, tool: "patch_lines",
  arguments: { sceneId: "ch01-lab", operations: [{ kind: "insert", gap: { leftId: "l-a", rightId: "l-b" },
    lines: [{ clientKey: "draft-ch01:insert-1", value: { speaker: null, text: "A lock opens." } }] }] },
};
assert.deepEqual(parseToolEnvelope(envelope), envelope);
console.log("PASS actual-package insert-envelope");
assert.throws(() => parseToolEnvelope({ ...envelope, tool: "run_shell" }),
  error => error instanceof HarnessError && error.code === "UNKNOWN_TOOL");
assert.throws(() => parseToolEnvelope({ ...envelope, arguments: { ...envelope.arguments, unknown: true } }),
  error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
console.log("PASS unknown-tool and unknown-field rejection");

// Given: scoped identities may repeat across scenes, but never within one scene.
const line = { id: "line", speaker: null, text: "Hello" };
const choice = { id: "choice", text: "Go", next: "start" };
const scene = { id: "start", background: "title", lines: [line], choices: [choice] };
const sourceHead = { projectId: "smoke", lineageId: uuid, revision: 0, scriptHash: hash, productionHash: hash };
const preview = { kind: "candidate-preview", previewId: uuid, projectId: "smoke", runId: uuid,
  candidateId: uuid, candidateRevision: 0, sourceHead, snapshotHash: hash,
  entry: { kind: "from-start", sceneId: "start" }, materializedScenes: [scene, { ...scene, id: "other" }],
  cast: [], initialFlags: {}, assetBindings: [], boundaries: [], includedUnitHashes: [] };
// When / Then: actual DTO entry point preserves scoped reuse and rejects local collisions.
assert.deepEqual(parsePreviewSnapshot(preview), preview);
for (const materializedScenes of [[scene, scene], [{ ...scene, lines: [line, line] }], [{ ...scene, choices: [choice, choice] }]]) {
  assert.throws(() => parsePreviewSnapshot({ ...preview, materializedScenes }),
    error => error instanceof HarnessError && error.code === "INVALID_INPUT");
}
const productionDocument = { version: 1, brief: "Draft", castCanon: [], worldTimeline: [], branchFacts: [],
  outline: { title: "Smoke", subtitle: "", bible: "", start: "start", scenes: [] }, artDirection: [], referenceBindings: [] };
const imported = { requestId: uuid, sourceHead, script: { title: "Smoke", subtitle: "", start: "start", characters: [], scenes: [scene] },
  productionDocument, limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only", initialScope: "imported-draft", archiveHash: hash,
  importedCandidateSeed: { productionDocument, scenes: preview.materializedScenes, reviews: [], assetManifest: [], provenance: "imported" } };
assert.deepEqual(parseSnapshotJson(createRunCommandSchema, JSON.stringify(imported)), imported);
assert.throws(() => parseSnapshotJson(createRunCommandSchema, JSON.stringify({ ...imported,
  importedCandidateSeed: { ...imported.importedCandidateSeed, scenes: [scene, scene] } })),
  error => error instanceof HarnessError && error.code === "INVALID_INPUT");
console.log("PASS B1 preview and imported JSON identities, including scoped reuse");

// Given / When / Then: patch compatibility is local; retained candidate fields are unknown.
const update = { ...envelope, tool: "patch_choices", arguments: { sceneId: "start", operations: [
  { kind: "update", choiceId: "choice", expectedEntityHash: hash, patch: { set: { set: { score: 1 }, add: { score: 2 } }, unset: [] } },
] } };
assert.throws(() => parseToolEnvelope(update), error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
console.log("PASS B2 contradictory nested choice effects rejected");

// Given / When / Then: both identical and conflicting duplicate keys reject, never deduplicate.
for (const text of ["One", "Two"]) {
  const input = { ...envelope, arguments: { sceneId: "start", operations: [{ kind: "insert", gap: { leftId: null, rightId: null },
    lines: [{ clientKey: "same", value: { speaker: null, text: "One" } }, { clientKey: "same", value: { speaker: null, text } }] }] } };
  assert.throws(() => parseToolEnvelope(input), error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
}
console.log("PASS B3 duplicate creation keys rejected for identical and different values");
const [first, second] = await Promise.all([canonicalHash(["a", "b"]), canonicalHash(["b", "a"])]);
assert.notEqual(first, second);
console.log(JSON.stringify({ assertion: "array-order-distinct", first, second }));
for (const [tokenWindowMode, allowed] of [["input-only", true], ["combined", false]] as const) {
  const input = parseBudgetRequest({
    requestPayloadHash: hash, capabilityBindingHash: hash, budgetGroupId: uuid, limitVersion: 0,
    textContextBytes: 30000, wireBodyBytes: 30000, images: [], requestedOutputTokens: 8192,
    counter: { kind: "exact", requestPayloadHash: hash, capabilityBindingHash: hash, inputTokens: 90000,
      includes: { text: true, tools: true, history: true, opaque: true, images: true } },
    capability: { accountScope: "smoke", providerProjectId: "smoke", modelId: "gemini-3.8-flash-high", configDigest: hash,
      evidenceHash: hash, counterSupport: "exact", tokenWindowMode, inputTokenLimit: 100000,
      combinedTokenLimit: 100000, outputTokenLimit: 8192, ready: true },
    limits: DEFAULT_BUDGET_LIMITS, policy: "exact-only", boundedPayloadApproved: false, unitAuthorized: true,
    used: { run: { textAttempts: 0, imageAttempts: 0, countRequests: 0 }, chapter: { textAttempts: 0, imageAttempts: 0, countRequests: 0 } },
    reserve: { textAttempts: 1, imageAttempts: 0, countRequests: 0 }, autoRepairRound: 0,
  });
  const result = admitBudget(input);
  assert.equal(result.allowed, allowed);
  console.log(JSON.stringify({ assertion: "I90000-O8192-S4096-L100000", mode: tokenWindowMode, allowed: result.allowed, tokenCheck: result.tokenCheck }));
}
