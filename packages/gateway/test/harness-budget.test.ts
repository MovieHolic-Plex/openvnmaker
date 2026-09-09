import assert from "node:assert/strict";
import { test } from "node:test";
import {
  admitBudget, budgetAdmissionSchema, budgetRequestSchema, DEFAULT_BUDGET_LIMITS, generationUsageSchema,
} from "../../harness/src/index.js";
import { budgetInput, capability, exactCounter, image, zeroCounters } from "../../harness/test/fixtures.js";
import {
  cancelCommand, chainedUnits, HASH, IDS, idleRun, makeRunner, pendingUnit, recordingDispatch, startCommand,
} from "./harness-runner-fixtures.js";

test("preserves thirty-thousand bytes beside seven-thousand tokens", () => {
  const input = budgetRequestSchema.parse({
    ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, counter: { ...exactCounter, inputTokens: 7000 },
  });
  const result = budgetAdmissionSchema.parse(admitBudget(input));
  assert.equal(result.textContextBytes, 30000);
  assert.equal(result.countedInputTokens, 7000);
  assert.notEqual(result.countedInputTokens, result.textContextBytes);
});

for (const [mode, allowed] of [["input-only", true], ["combined", false]] as const) {
  test(`applies ${mode} window when I=90000 O=8192 S=4096 L=100000`, () => {
    const input = budgetRequestSchema.parse({
      ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, capability: { ...capability, tokenWindowMode: mode },
    });
    const result = admitBudget(input);
    assert.equal(result.allowed, allowed);
    assert.equal(result.countedInputTokens, 90000);
  });
}

for (const [policy, approved, allowed] of [
  ["exact-only", false, false], ["bounded-payload", false, false], ["bounded-payload", true, true],
] as const) {
  test(`keeps tokenCheck unknown when ${policy} approval=${approved} for four uncounted images`, () => {
    const input = budgetRequestSchema.parse({
      ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, images: [image, image, image, image],
      counter: { kind: "unsupported" }, policy, boundedPayloadApproved: approved,
    });
    const result = admitBudget(input);
    assert.equal(result.tokenCheck, "unknown");
    assert.equal(result.allowed, allowed);
    assert.equal(result.authorization, allowed ? "bounded-payload-approved" : null);
  });
}

for (const policy of ["exact-only", "bounded-payload"] as const) {
  test(`rejects twelve-mebibyte-plus images when policy is ${policy}`, () => {
    const input = budgetRequestSchema.parse({
      ...budgetInput, limits: DEFAULT_BUDGET_LIMITS, policy, boundedPayloadApproved: true,
      images: [image, image].map(row => ({ ...row, rawBytes: 6 * 1024 * 1024 + 1 })),
    });
    const result = admitBudget(input);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "ALL_IMAGE_BYTES_LIMIT");
  });
}

test("preserves missing generation usage as null instead of zero", () => {
  const result = generationUsageSchema.parse({ knownInputUsage: null, knownOutputUsage: null });
  assert.equal(result.knownInputUsage, null);
  assert.equal(result.knownOutputUsage, null);
});

test("cancel does not refund a reservation or permit another dispatch", async () => {
  const { runner, dispatch, ids } = makeRunner();
  const created = await runner.create(ids.uuid(), idleRun(chainedUnits()));
  await runner.apply(created.id, startCommand(created, [IDS.u1, IDS.u2], ids.uuid()));
  const ready = await runner.pump(created.id);
  assert.equal(ready.stopReason, "unit-ready");
  assert.equal(dispatch.calls, 1);
  const used = runner.getSnapshot(created.id).used.run.textAttempts;
  assert.equal(used, 1);
  await runner.apply(created.id, cancelCommand(runner.getRun(created.id), ids.uuid()));
  const after = await runner.pump(created.id);
  assert.equal(after.dispatched, 0);
  assert.equal(dispatch.calls, 1);
  assert.equal(runner.getSnapshot(created.id).used.run.textAttempts, used);
});

test("limit change below used is rejected and an increase does not auto-resume", async () => {
  const tightLimits = {
    ...DEFAULT_BUDGET_LIMITS,
    run: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
    chapter: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
  };
  const { runner, dispatch, ids } = makeRunner();
  const created = await runner.create(ids.uuid(), { ...idleRun(chainedUnits()), limits: tightLimits });
  await runner.apply(created.id, startCommand(runner.getRun(created.id), [IDS.u1, IDS.u2], ids.uuid(), tightLimits));
  await runner.pump(created.id);
  const paused = await runner.pump(created.id);
  assert.equal(paused.stopReason, "paused-budget");
  assert.equal(dispatch.calls, 1);
  const current = runner.getRun(created.id);
  await assert.rejects(() => runner.apply(current.id, {
    action: "budget", requestId: ids.uuid(), expectedRunVersion: current.version, expectedLimitVersion: current.limitVersion,
    limits: { ...tightLimits, run: { textAttempts: 0, imageAttempts: 0, countRequests: 0 } },
    tokenPolicy: "exact-only", reason: "shrink",
  }));
  const raised = await runner.apply(current.id, {
    action: "budget", requestId: ids.uuid(), expectedRunVersion: runner.getRun(current.id).version,
    expectedLimitVersion: runner.getRun(current.id).limitVersion,
    limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only", reason: "raise",
  });
  assert.equal(raised.state.status, "paused");
  assert.equal(dispatch.calls, 1);
  const idlePump = await runner.pump(current.id);
  assert.equal(idlePump.dispatched, 0);
  assert.equal(dispatch.calls, 1);
});

test("unknown-effect replacement and repropose keep the old reservation", async () => {
  const unknownDispatch = recordingDispatch({ reply: async () => ({ kind: "unknown", reason: "disconnected" }) });
  const { runner, ids } = makeRunner({ dispatch: unknownDispatch });
  const created = await runner.create(ids.uuid(), idleRun([pendingUnit(IDS.u1, "outline", [])]));
  await runner.apply(created.id, startCommand(created, [IDS.u1], ids.uuid()));
  const unknown = await runner.pump(created.id);
  assert.equal(unknown.stopReason, "paused-unknown-effect");
  assert.equal(unknownDispatch.calls, 1);
  const snapshot = runner.getSnapshot(created.id);
  assert.equal(snapshot.used.run.textAttempts, 1);
  const lost = snapshot.effects[0];
  assert.equal(lost?.state, "unknown");
  const retried = await runner.apply(created.id, {
    action: "retry-effect", requestId: ids.uuid(), expectedRunVersion: snapshot.run.version,
    effectId: lost?.effectId ?? HASH.a, payloadHash: lost?.payloadHash ?? HASH.a, authorizeReplacement: true,
  });
  assert.equal(retried.state.status, "paused");
  assert.equal(runner.getSnapshot(created.id).effects.length, 1);
  assert.equal(runner.getSnapshot(created.id).effects[0]?.state, "unknown");
  const child = await runner.apply(created.id, {
    action: "repropose", requestId: ids.uuid(), expectedRunVersion: runner.getRun(created.id).version,
    analysisId: ids.uuid(), analysisDigest: HASH.a, newBaseHead: created.sourceHead,
    reuseUnitIds: [], reuseAssetIds: [], resolutions: [],
  });
  assert.notEqual(child.id, created.id);
  assert.equal(child.budgetGroupId, created.budgetGroupId);
  assert.equal(child.budgetOwnerRunId, created.id);
  assert.equal(child.state.status, "idle");
  await runner.apply(child.id, startCommand(child, [IDS.u1], ids.uuid(), {
    ...DEFAULT_BUDGET_LIMITS, run: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
    chapter: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
  }));
  const blocked = await runner.pump(child.id);
  assert.equal(blocked.dispatched, 0);
  assert.equal(unknownDispatch.calls, 1);
  assert.equal(runner.getSnapshot(created.id).used.run.textAttempts, 1);
  assert.equal(runner.getSnapshot(created.id).effects[0]?.state, "unknown");
});
