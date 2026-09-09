import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  candidateRefSchema, hashSchema, parseToolEnvelope,
  sceneIdSchema, validationReportSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { validationFixture } from "./operations-validation-fixture.js";

const dataSchema = z.object({
  kind: z.literal("candidate-validation"),
  candidateRef: candidateRefSchema,
  candidateDigest: hashSchema,
  scope: z.object({
    mode: z.enum(["local", "proposal"]), sceneIds: z.array(sceneIdSchema),
  }),
  report: validationReportSchema,
});

test("returns bound local validation evidence without converting failed checks into completion", async () => {
  // Given
  const f = await validationFixture();
  const before = structuredClone(f.input.candidate);

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  const data = dataSchema.parse(outcome.result.data);
  assert.deepEqual(data.candidateRef, f.preparedValidation.candidateRef);
  assert.equal(data.candidateDigest, f.preparedValidation.candidateDigest);
  assert.deepEqual(data.scope, f.preparedValidation.scope);
  assert.deepEqual(data.report, f.preparedValidation.report);
  assert.deepEqual(outcome.result.readSet, f.preparedValidation.readSet);
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});

test("rejects validation when prepared service evidence is absent", async () => {
  // Given
  const f = await validationFixture();
  const { preparedValidation: omitted, ...input } = f.input;
  assert.equal(omitted, f.preparedValidation);

  // When
  const outcome = await applyCandidateTool({ ...input, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_STATE");
  assert.deepEqual(outcome.candidate, input.candidate);
});

const staleEvidence = [
  { name: "content digest", foreignCandidate: false, staleDigest: true, sceneIds: ["start"], code: "STALE_REVIEW" },
  { name: "candidate identity", foreignCandidate: true, staleDigest: false, sceneIds: ["start"], code: "STALE_REVIEW" },
  { name: "requested scope", foreignCandidate: false, staleDigest: false, sceneIds: ["end"], code: "INVALID_OPERATION" },
] as const;

for (const scenario of staleEvidence) {
  test(`rejects validation evidence when its ${scenario.name} does not match`, async () => {
    // Given
    const f = await validationFixture();
    const preparedValidation = {
      ...f.preparedValidation,
      candidateRef: candidateRefSchema.parse({
        ...f.preparedValidation.candidateRef,
        candidateId: scenario.foreignCandidate
          ? "00000000-0000-4000-8000-000000000099"
          : f.preparedValidation.candidateRef.candidateId,
      }),
      candidateDigest: scenario.staleDigest
        ? hashSchema.parse("b".repeat(64)) : f.preparedValidation.candidateDigest,
      scope: {
        ...f.preparedValidation.scope,
        sceneIds: sceneIdSchema.array().parse(scenario.sceneIds),
      },
    };

    // When
    const outcome = await applyCandidateTool({
      ...f.input, preparedValidation, envelope: f.envelope,
    });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, scenario.code);
    assert.deepEqual(outcome.candidate, f.input.candidate);
  });
}

test("rejects partial proposal evidence even when the model requests only one scene", async () => {
  // Given
  const f = await validationFixture();
  const envelope = parseToolEnvelope({
    ...f.envelope, arguments: { mode: "proposal", sceneIds: ["start"] },
  });
  const preparedValidation = {
    ...f.preparedValidation,
    scope: { mode: "proposal" as const, sceneIds: [sceneIdSchema.parse("start")] },
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedValidation, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_OPERATION");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("uses complete proposal scope rather than a model-supplied subset", async () => {
  // Given
  const f = await validationFixture();
  const envelope = parseToolEnvelope({
    ...f.envelope, arguments: { mode: "proposal", sceneIds: ["start"] },
  });
  const scope = {
    mode: "proposal" as const,
    sceneIds: sceneIdSchema.array().parse(["end", "start"]),
  };
  const preparedValidation = { ...f.preparedValidation, scope };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedValidation, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  const data = dataSchema.parse(outcome.result.data);
  assert.deepEqual(data.scope, scope);
  assert.deepEqual(data.report, f.preparedValidation.report);
  assert.deepEqual(outcome.result.writeSet, []);
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rejects local validation of an unmaterialized target", async () => {
  // Given
  const f = await validationFixture();
  const envelope = parseToolEnvelope({
    ...f.envelope, arguments: { mode: "local", sceneIds: ["missing"] },
  });
  const preparedValidation = {
    ...f.preparedValidation,
    scope: { mode: "local" as const, sceneIds: [sceneIdSchema.parse("missing")] },
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedValidation, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "STALE_TARGET");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("replays historical validation evidence without preparing another report", async () => {
  // Given
  const f = await validationFixture();
  const first = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(first.result.ok, true);
  const { preparedValidation: omitted, ...input } = f.input;
  assert.equal(omitted, f.preparedValidation);

  // When
  const replay = await applyCandidateTool({
    ...input, candidate: first.candidate, journal: first.journal, envelope: f.envelope,
  });

  // Then
  assert.deepEqual(replay.result, first.result);
  assert.deepEqual(replay.candidate, first.candidate);
  assert.deepEqual(replay.journal, first.journal);
});
