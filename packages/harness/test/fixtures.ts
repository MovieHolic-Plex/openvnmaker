export const uuid = "00000000-0000-4000-8000-000000000001";
export const hash = "a".repeat(64);
export const otherHash = "b".repeat(64);
export const head = { projectId: "project-legacy", lineageId: uuid, revision: 4, scriptHash: hash, productionHash: otherHash };
export const script = { title: "Fixture", subtitle: "", start: "start", characters: [],
  scenes: [{ id: "start", background: "title", lines: [{ id: "l-a", speaker: null, text: "Hello" }], ending: "End" }] };
export const outline = { title: "Fixture", subtitle: "", bible: "", start: "start", scenes: [] };
export const productionDocument = { version: 1, brief: "Draft", castCanon: [], worldTimeline: [], branchFacts: [],
  outline, artDirection: [], referenceBindings: [] };
export const insert = { callId: uuid, candidateId: uuid, expectedCandidateRevision: 4, tool: "patch_lines",
  arguments: { sceneId: "ch01-lab", operations: [{ kind: "insert", gap: { leftId: "l-a", rightId: "l-b" },
    lines: [{ clientKey: "draft-ch01:insert-1", value: { speaker: null, text: "문 너머에서 잠금쇠가 풀리는 소리가 났다." } }] }] } };
export const zeroCounters = { textAttempts: 0, imageAttempts: 0, countRequests: 0 };
export const capability = {
  accountScope: "fixture-account", providerProjectId: "fixture-project", modelId: "gemini-3.8-flash-high",
  configDigest: hash, evidenceHash: otherHash, counterSupport: "exact", tokenWindowMode: "input-only",
  inputTokenLimit: 100000, outputTokenLimit: 8192, combinedTokenLimit: 100000, ready: true,
};
export const exactCounter = { kind: "exact", requestPayloadHash: hash, capabilityBindingHash: otherHash,
  inputTokens: 90000, includes: { text: true, tools: true, history: true, opaque: true, images: true } };
export const budgetInput = {
  requestPayloadHash: hash, capabilityBindingHash: otherHash, budgetGroupId: uuid, limitVersion: 0,
  textContextBytes: 30000, wireBodyBytes: 30000, images: [], requestedOutputTokens: 8192,
  counter: exactCounter, capability, policy: "exact-only", boundedPayloadApproved: false, unitAuthorized: true,
  used: { run: zeroCounters, chapter: zeroCounters }, reserve: { ...zeroCounters, textAttempts: 1 }, autoRepairRound: 0,
};
export const image = { originalHash: hash, sentHash: otherHash, mime: "image/png", width: 1024, height: 1024, rawBytes: 1024 };
