import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  admitBudget, canonicalHash, effectSchema, hashSchema,
  parseBudgetRequest, parseToolEnvelope, toolArgumentsSchemas,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { artFixture } from "./operations-art-fixture.js";

const queuedSchema = z.object({
  kind: z.literal("art-intent"),
  request: toolArgumentsSchemas.request_art,
  toolPayloadHash: hashSchema,
  effect: effectSchema,
});

test("returns only a queued art intent when exact request preparation and trusted grant match", async () => {
  // Given
  const f = await artFixture();
  const before = structuredClone(f.input.candidate);

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  const queued = queuedSchema.parse(outcome.result.data);
  assert.deepEqual(queued.request, f.args);
  assert.equal(queued.toolPayloadHash, f.preparedArt.toolPayloadHash);
  assert.deepEqual(queued.effect, f.preparedArt.effect);
  assert.equal(queued.effect.state, "intent");
  assert.deepEqual(outcome.journal.calls[0]?.requiredWriteSet, f.input.authorizedWriteSet);
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});

test("rejects art requests when trusted preparation is absent", async () => {
  // Given
  const f = await artFixture();
  const { preparedArt: omitted, ...input } = f.input;
  assert.equal(omitted, f.preparedArt);

  // When
  const outcome = await applyCandidateTool({ ...input, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_STATE");
  assert.deepEqual(outcome.candidate, input.candidate);
});

test("rejects prepared art when its request grant is absent", async () => {
  // Given
  const f = await artFixture();

  // When
  const outcome = await applyCandidateTool({
    ...f.input, authorizedWriteSet: [], envelope: f.envelope,
  });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "WRITE_SCOPE_DENIED");
  assert.deepEqual(outcome.candidate, f.input.candidate);
  assert.deepEqual(outcome.journal, f.input.journal);
});

test("rejects prepared art when its tool-call hash belongs to different arguments", async () => {
  // Given
  const f = await artFixture();
  const preparedArt = { ...f.preparedArt, toolPayloadHash: hashSchema.parse("a".repeat(64)) };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "ID_PAYLOAD_CONFLICT");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rejects art admission when it is bound to another outbound payload", async () => {
  // Given
  const f = await artFixture();
  const preparedArt = {
    ...f.preparedArt,
    effect: {
      ...f.preparedArt.effect,
      admission: {
        ...f.preparedArt.effect.admission,
        requestPayloadHash: hashSchema.parse("f".repeat(64)),
      },
    },
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_OPERATION");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rejects art intent when actual budget admission denies the image reservation", async () => {
  // Given
  const f = await artFixture();
  const admission = admitBudget(parseBudgetRequest({
    ...f.budgetRequest, limitVersion: 1,
    limits: {
      ...f.budgetRequest.limits,
      run: { ...f.budgetRequest.limits.run, imageAttempts: 0 },
    },
  }));
  assert.equal(admission.allowed, false);
  const preparedArt = {
    ...f.preparedArt, effect: { ...f.preparedArt.effect, admission },
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "LIMIT_EXCEEDED");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rejects prepared art when its scoped target does not exist", async () => {
  // Given
  const f = await artFixture();
  const envelope = parseToolEnvelope({
    ...f.envelope,
    arguments: { ...f.args, target: { kind: "scene", sceneId: "missing", slot: "background" } },
  });
  const preparedArt = {
    ...f.preparedArt,
    toolPayloadHash: await canonicalHash({ unitId: f.input.unitId, envelope }),
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "STALE_TARGET");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("replays an accepted art receipt without requiring preparation or creating a second intent", async () => {
  // Given
  const f = await artFixture();
  const first = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(first.result.ok, true);
  const { preparedArt: omitted, ...input } = f.input;
  assert.equal(omitted, f.preparedArt);

  // When
  const replay = await applyCandidateTool({
    ...input, candidate: first.candidate, journal: first.journal, envelope: f.envelope,
  });

  // Then
  assert.deepEqual(replay.result, first.result);
  assert.deepEqual(replay.journal, first.journal);
  assert.deepEqual(replay.candidate, first.candidate);
});
