import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  approvedArtBindingSchema, budgetAdmissionSchema, candidateRefSchema,
  canonicalHash, canonicalJson, effectSchema, parseProductionDocument, parseToolEnvelope,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { artReferenceFixture } from "./operations-art-reference-fixture.js";

test("associates registered references in request order without deduplicating repeated bindings", async () => {
  // Given
  const f = await artReferenceFixture(["second", "first", "second"]);
  const before = structuredClone(f.input.candidate);

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  const data = z.object({
    referenceBindings: z.array(approvedArtBindingSchema), effect: effectSchema,
  }).parse(outcome.result.data);
  assert.deepEqual(data.referenceBindings, f.selected);
  assert.deepEqual(data.effect.admission.images, f.images);
  assert.deepEqual(data.referenceBindings.map(binding => binding.deliveryHash), [
    f.bindings.second.deliveryHash, f.bindings.first.deliveryHash, f.bindings.second.deliveryHash,
  ]);
  assert.deepEqual(outcome.result.writeSet, []);
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});

const aliases = [
  { key: "assetId", code: "INVALID_INPUT" },
  { key: "logical", code: "INVALID_INPUT" },
  { key: "version", code: "INVALID_INPUT" },
  { key: "original", code: "STALE_TARGET" },
  { key: "delivery", code: "STALE_TARGET" },
] as const;

for (const alias of aliases) {
  test(`rejects ${alias.key} identity when a full binding-record hash is required`, async () => {
    // Given
    const f = await artReferenceFixture();
    const binding = f.bindings.first;
    const values = {
      assetId: binding.assetId,
      logical: canonicalJson({ assetId: binding.assetId, role: binding.role, target: binding.target }),
      version: binding.referenceVersionIds[0],
      original: binding.originalHash,
      delivery: binding.deliveryHash,
    };
    const value = values[alias.key];
    assert.ok(value);
    const envelope = parseToolEnvelope({
      ...f.envelope, arguments: { ...f.args, referenceBindingIds: [value] },
    });
    const preparedArt = {
      ...f.preparedArt,
      toolPayloadHash: await canonicalHash({ unitId: f.input.unitId, envelope }),
    };

    // When
    const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, alias.code);
    assert.deepEqual(outcome.candidate, f.input.candidate);
  });
}

for (const count of ["missing", "extra"] as const) {
  test(`rejects reference association when prepared images contain a ${count} entry`, async () => {
    // Given
    const f = await artReferenceFixture();
    const images = { missing: [], extra: [...f.images, ...f.images] };
    const admission = budgetAdmissionSchema.parse({
      ...f.preparedArt.effect.admission, images: images[count],
    });
    const preparedArt = { ...f.preparedArt, effect: { ...f.preparedArt.effect, admission } };

    // When
    const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "INVALID_OPERATION");
    assert.deepEqual(outcome.candidate, f.input.candidate);
  });
}

test("rejects delivery-hash substitution for the declared original reference", async () => {
  // Given
  const f = await artReferenceFixture();
  const admission = budgetAdmissionSchema.parse({
    ...f.preparedArt.effect.admission,
    images: f.images.map(image => ({ ...image, originalHash: f.bindings.first.deliveryHash })),
  });
  const preparedArt = { ...f.preparedArt, effect: { ...f.preparedArt.effect, admission } };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_OPERATION");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rejects reordered image metadata when it no longer matches reference order", async () => {
  // Given
  const f = await artReferenceFixture(["first", "second"]);
  const admission = budgetAdmissionSchema.parse({
    ...f.preparedArt.effect.admission, images: [...f.images].reverse(),
  });
  const preparedArt = { ...f.preparedArt, effect: { ...f.preparedArt.effect, admission } };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_OPERATION");
});

test("rejects a stale binding hash on a fresh call even when original bytes are unchanged", async () => {
  // Given
  const f = await artReferenceFixture();
  const candidate = {
    ...f.input.candidate,
    ref: candidateRefSchema.parse({ ...f.input.candidate.ref, revision: 5 }),
    productionDocument: parseProductionDocument({
      ...f.input.candidate.productionDocument,
      referenceBindings: [{ ...f.bindings.first, deliveryHash: "9".repeat(64) }, f.bindings.second],
    }),
  };
  const envelope = parseToolEnvelope({
    ...f.envelope, callId: "00000000-0000-4000-8000-000000000002",
    expectedCandidateRevision: candidate.ref.revision,
  });
  const preparedArt = {
    ...f.preparedArt,
    toolPayloadHash: await canonicalHash({ unitId: f.input.unitId, envelope }),
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, candidate, preparedArt, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "STALE_TARGET");
  assert.deepEqual(outcome.candidate, candidate);
});

test("replays historical reference receipts exactly after current bindings change", async () => {
  // Given
  const f = await artReferenceFixture();
  const first = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(first.result.ok, true);
  const candidate = {
    ...first.candidate,
    ref: candidateRefSchema.parse({ ...first.candidate.ref, revision: 5 }),
    productionDocument: parseProductionDocument({
      ...first.candidate.productionDocument, referenceBindings: [],
    }),
  };
  const { preparedArt: omitted, ...input } = f.input;
  assert.equal(omitted, f.preparedArt);

  // When
  const replay = await applyCandidateTool({
    ...input, candidate, journal: first.journal, envelope: f.envelope,
  });

  // Then
  assert.deepEqual(replay.result, first.result);
  assert.deepEqual(replay.candidate, candidate);
  assert.deepEqual(replay.journal, first.journal);
});
