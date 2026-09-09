import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  admitBudget, budgetAdmissionSchema, canonicalHash, effectSchema,
  parseBudgetRequest, parseToolEnvelope,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { artFixture } from "./operations-art-fixture.js";
import { image } from "./fixtures.js";

const counterDenials = [
  { name: "authentication", counter: { kind: "error", code: "auth" }, policy: "exact-only", code: "AUTH_REQUIRED" },
  { name: "quota", counter: { kind: "error", code: "quota" }, policy: "exact-only", code: "QUOTA" },
  { name: "transport", counter: { kind: "error", code: "transport" }, policy: "exact-only", code: "UPSTREAM" },
  { name: "unsupported exact counting", counter: { kind: "unsupported" }, policy: "exact-only", code: "CAPABILITY_REQUIRED" },
  { name: "missing bounded approval", counter: { kind: "unsupported" }, policy: "bounded-payload", code: "REVIEW_REQUIRED" },
] as const;

for (const scenario of counterDenials) {
  test(`preserves art denial semantics when admission reports ${scenario.name}`, async () => {
    // Given
    const f = await artFixture();
    const admission = admitBudget(parseBudgetRequest({
      ...f.budgetRequest, counter: scenario.counter,
      policy: scenario.policy, boundedPayloadApproved: false,
    }));
    assert.equal(admission.allowed, false);
    assert.equal(admission.tokenCheck, "unknown");
    const preparedArt = {
      ...f.preparedArt, effect: { ...f.preparedArt.effect, admission },
    };

    // When
    const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, scenario.code);
    assert.equal(outcome.result.message, admission.reason);
    assert.deepEqual(outcome.candidate, f.input.candidate);
  });
}

for (const reason of ["COUNTER_CAPABILITY_UNKNOWN", "UNRECOGNIZED_LIMIT"]) {
  test(`preserves an unrecognized denial without claiming measured excess when reason is ${reason}`, async () => {
    // Given: the persisted admission contract intentionally accepts identifier-valued reasons.
    const f = await artFixture();
    const unknown = admitBudget(parseBudgetRequest({
      ...f.budgetRequest, counter: { kind: "unsupported" },
    }));
    const admission = budgetAdmissionSchema.parse({ ...unknown, reason });
    const preparedArt = {
      ...f.preparedArt, effect: { ...f.preparedArt.effect, admission },
    };

    // When
    const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "INVALID_STATE");
    assert.equal(outcome.result.message, reason);
    assert.deepEqual(outcome.candidate, f.input.candidate);
  });
}

test("reports a measured limit when the admitted request exceeds its wire-byte allowance", async () => {
  // Given
  const f = await artFixture();
  const admission = admitBudget(parseBudgetRequest({
    ...f.budgetRequest, limitVersion: 1,
    limits: {
      ...f.budgetRequest.limits,
      request: {
        ...f.budgetRequest.limits.request,
        wireBodyBytes: f.budgetRequest.wireBodyBytes - 1,
      },
    },
  }));
  assert.equal(admission.reason, "WIRE_BYTES_LIMIT");
  const preparedArt = {
    ...f.preparedArt, effect: { ...f.preparedArt.effect, admission },
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "LIMIT_EXCEEDED");
  assert.equal(outcome.result.message, admission.reason);
});

test("retains unknown token measurement when bounded-payload admission was explicitly approved", async () => {
  // Given
  const f = await artFixture();
  const admission = admitBudget(parseBudgetRequest({
    ...f.budgetRequest, counter: { kind: "unsupported" },
    policy: "bounded-payload", boundedPayloadApproved: true,
  }));
  assert.equal(admission.allowed, true);
  const preparedArt = {
    ...f.preparedArt, effect: { ...f.preparedArt.effect, admission },
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  const data = z.object({ effect: effectSchema }).parse(outcome.result.data);
  assert.equal(data.effect.admission.tokenCheck, "unknown");
  assert.equal(data.effect.admission.countedInputTokens, null);
  assert.equal(data.effect.admission.authorization, "bounded-payload-approved");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rejects an explicit reference identifier that is not a binding-record hash", async () => {
  // Given
  const f = await artFixture();
  const envelope = parseToolEnvelope({
    ...f.envelope, arguments: { ...f.args, referenceBindingIds: ["unregistered-reference"] },
  });
  const preparedArt = {
    ...f.preparedArt,
    toolPayloadHash: await canonicalHash({ unitId: f.input.unitId, envelope }),
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_INPUT");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

test("rejects prepared image inputs when tool arguments omit their reference IDs", async () => {
  // Given
  const f = await artFixture();
  const admission = budgetAdmissionSchema.parse({
    ...f.preparedArt.effect.admission, images: [image],
  });
  const preparedArt = {
    ...f.preparedArt, effect: { ...f.preparedArt.effect, admission },
  };

  // When
  const outcome = await applyCandidateTool({ ...f.input, preparedArt, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_OPERATION");
  assert.deepEqual(outcome.candidate, f.input.candidate);
});
