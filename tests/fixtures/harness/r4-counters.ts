import { canonicalHash, capabilityBindingSchema, tokenCounterResultSchema, parseBudgetRequest, DEFAULT_BUDGET_LIMITS } from "@vnmaker/harness";
import { FIXTURE_IDS } from "./heads.js";

export async function counterFixtures() {
  const payload = { synthetic: true, text: "x".repeat(30000), tools: [], history: [], opaque: "fixture-signature" } as const;
  const requestPayloadHash = await canonicalHash(payload);
  const capability = capabilityBindingSchema.parse({ accountScope: "synthetic-no-account", providerProjectId: "synthetic-project",
    modelId: "gemini-3.8-flash-high", configDigest: await canonicalHash({ synthetic: true }), evidenceHash: await canonicalHash({ probe: "fixture-not-live" }),
    counterSupport: "exact", tokenWindowMode: "input-only", inputTokenLimit: 100000, outputTokenLimit: 8192, combinedTokenLimit: 100000, ready: true });
  const capabilityBindingHash = await canonicalHash(capability);
  const exact = tokenCounterResultSchema.parse({ kind: "exact", requestPayloadHash, capabilityBindingHash,
    inputTokens: 7000, includes: { text: true, tools: true, history: true, opaque: true, images: true } });
  const unsupported = tokenCounterResultSchema.parse({ kind: "unsupported" });
  const errors = ["auth", "quota", "transport"].map(code => tokenCounterResultSchema.parse({ kind: "error", code }));
  const zero = { textAttempts: 0, imageAttempts: 0, countRequests: 0 };
  const request = parseBudgetRequest({ requestPayloadHash, capabilityBindingHash, budgetGroupId: FIXTURE_IDS.budgetGroup, limitVersion: 0,
    textContextBytes: 30000, wireBodyBytes: Buffer.byteLength(JSON.stringify(payload)), images: [], requestedOutputTokens: 8192,
    counter: exact, capability, limits: DEFAULT_BUDGET_LIMITS, policy: "exact-only", boundedPayloadApproved: false,
    unitAuthorized: true, used: { run: zero, chapter: zero }, reserve: { ...zero, textAttempts: 1 }, autoRepairRound: 0 });
  return { payload, exact, unsupported, errors, request } as const;
}
