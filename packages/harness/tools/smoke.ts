import assert from "node:assert/strict";
import { admitBudget, canonicalHash, DEFAULT_BUDGET_LIMITS, HarnessError, parseBudgetRequest, parseToolEnvelope } from "@vnmaker/harness";

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
