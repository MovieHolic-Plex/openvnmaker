import assert from "node:assert/strict";
import test from "node:test";
import { canonicalBytes, canonicalHash } from "../src/canonical.js";
import { buildContextManifest } from "../src/context.js";
import type { ContextManifestInput } from "../src/context.js";
import {
  budgetRequestSchema,
  DEFAULT_BUDGET_LIMITS,
} from "../src/budget-contracts.js";
import { canonEntrySchema } from "../src/production-contracts.js";
import { projectHeadSchema } from "../src/primitives.js";
import { budgetInput, exactCounter, head } from "./fixtures.js";

async function fixture(count: number) {
  const facts = Array.from({ length: count }, (_, index) =>
    canonEntrySchema.parse({
      id: `fact-${index}`, category: "world-fact",
      text: "required".repeat(250),
      characterIds: [], sceneIds: [], relatedEntryIds: [],
      truth: { kind: "world" },
    }));
  const sourceHead = projectHeadSchema.parse(head);
  const input: ContextManifestInput = {
    sourceHead, windows: [],
    facts: await Promise.all(facts.map(async fact => ({
      factId: fact.id, sourceHead, sceneIds: [], lineIds: [],
      sourceHash: await canonicalHash(fact),
    }))),
    readSet: [], referenceBindingHashes: [], excluded: [],
  };
  // Full synthetic adapter input, including original canon text and truth.
  // The exact counter is scripted evidence, not a live provider measurement.
  const payload = { context: { facts, manifest: input }, tools: [], history: [] };
  const requestPayloadHash = await canonicalHash(payload);
  const bytes = canonicalBytes(payload).byteLength;
  const budget = budgetRequestSchema.parse({
    ...budgetInput, limits: DEFAULT_BUDGET_LIMITS,
    requestPayloadHash, textContextBytes: bytes, wireBodyBytes: bytes,
    counter: { ...exactCounter, requestPayloadHash, inputTokens: 7000 },
  });
  return { input, budget };
}

test("required-context-does-not-fit blocks measured required canon without trimming", async () => {
  // Given original required canon exceeding the full-request byte limit.
  const { input, budget } = await fixture(40);
  // When context admission uses that request's measurements.
  const result = await buildContextManifest(input, undefined, budget);
  // Then admission blocks and retains every required provenance record.
  assert.equal(result.kind, "budget-blocked");
  assert.equal(result.admission.reason, "TEXT_BYTES_LIMIT");
  assert.deepEqual(result.manifest.facts, input.facts);
  assert.deepEqual(result.manifest.excluded, []);
});

test("preserves exact counter tokens separately from measured request bytes", async () => {
  // Given a measured request and a distinct scripted exact token count.
  const { input, budget } = await fixture(1);
  // When the existing budget policy admits it.
  const result = await buildContextManifest(input, undefined, budget);
  // Then neither measurement is replaced with the other.
  assert.equal(result.kind, "ready");
  assert.ok(result.admission);
  assert.equal(result.admission.countedInputTokens, 7000);
  assert.equal(result.admission.textContextBytes, budget.textContextBytes);
  assert.equal(result.admission.requestPayloadHash, budget.requestPayloadHash);
});
