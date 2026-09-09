import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductionRunner, hashSchema, MemoryRunnerStore } from "../../harness/src/index.js";
import type { ProviderDispatchResult } from "../../harness/src/index.js";
import {
  HASH, IDS, cancelCommand, chainedUnits, exactCounterPort, idleRun, makeRunner, mutableClock,
  productionCapability, recordingDispatch, resumeCommand, sequentialIds, startCommand, waitForState,
} from "./harness-runner-fixtures.js";

test("resume-without-duplicate-effects", async () => {
  const dispatch = recordingDispatch();
  const store = new MemoryRunnerStore();
  const clock = mutableClock(0);
  const ids = sequentialIds();
  const deps = { store, dispatch, clock, ids, capability: productionCapability(), counter: exactCounterPort() };
  const runner = createProductionRunner(deps);
  const created = await runner.create(ids.uuid(), idleRun(chainedUnits()));
  assert.equal(created.state.status, "idle");
  assert.equal(created.sourceHead.revision, 4);
  assert.equal(created.candidateRef.revision, 0);
  const started = waitForState(runner, run => run.state.status === "running");
  await runner.apply(created.id, startCommand(created, [IDS.u1, IDS.u2, IDS.u3], ids.uuid()));
  await started;
  const first = await runner.pump(created.id);
  const second = await runner.pump(created.id);
  const third = await runner.pump(created.id);
  assert.equal(first.stopReason, "unit-ready");
  assert.equal(second.stopReason, "unit-ready");
  assert.equal(third.stopReason, "unit-ready");
  assert.deepEqual(dispatch.unitIds, [IDS.u1, IDS.u2, IDS.u3]);
  assert.equal(dispatch.calls, 3);
  const ready = runner.getRun(created.id);
  assert.equal(ready.units.filter(unit => unit.status === "ready").length, 3);
  assert.equal(ready.sourceHead.revision, 4);
  assert.equal(ready.candidateRef.revision, 0);
  clock.advance(30_000);
  const restarted = createProductionRunner(deps);
  const recovered = waitForState(restarted, run => run.state.status === "paused");
  restarted.recover(clock.now());
  const interrupted = await recovered;
  assert.equal(interrupted.state.status, "paused");
  if (interrupted.state.status === "paused") assert.equal(interrupted.state.reason, "interrupted");
  const fenced = await restarted.pump(created.id);
  assert.equal(fenced.dispatched, 0);
  assert.equal(dispatch.calls, 3);
  const resumed = waitForState(restarted, run => run.state.status === "running");
  await restarted.apply(created.id, resumeCommand(interrupted, ids.uuid(), restarted.getSnapshot(created.id).meta.capabilityBindingHash));
  await resumed;
  const after = await restarted.pump(created.id);
  assert.equal(after.dispatched, 0);
  assert.equal(dispatch.calls, 3);
  assert.equal(restarted.getRun(created.id).units.filter(unit => unit.status === "ready").length, 3);
  assert.notEqual(after.stopReason, "completed");
});

test("cancel-quota-budget-fencing", async () => {
  const disconnectDispatch = recordingDispatch();
  const disconnected = makeRunner({ dispatch: disconnectDispatch });
  const seeded = await disconnected.runner.create(disconnected.ids.uuid(), idleRun(chainedUnits()));
  await disconnected.runner.apply(seeded.id, startCommand(seeded, [IDS.u1, IDS.u2, IDS.u3], disconnected.ids.uuid()));
  disconnected.runner.disconnect(seeded.id);
  assert.equal(disconnected.runner.getRun(seeded.id).state.status, "running");
  await disconnected.runner.pump(seeded.id);
  assert.equal(disconnectDispatch.calls, 1);
  assert.notEqual(disconnected.runner.getRun(seeded.id).state.status, "cancelled");

  const before = makeRunner();
  const beforeRun = await before.runner.create(before.ids.uuid(), idleRun(chainedUnits()));
  await before.runner.apply(beforeRun.id, startCommand(beforeRun, [IDS.u1], before.ids.uuid()));
  const cancelled = waitForState(before.runner, run => run.state.status === "cancelled");
  await before.runner.apply(beforeRun.id, cancelCommand(before.runner.getRun(beforeRun.id), before.ids.uuid()));
  await cancelled;
  const beforeStep = await before.runner.pump(beforeRun.id);
  assert.equal(before.dispatch.calls, 0);
  assert.equal(beforeStep.dispatched, 0);
  assert.equal(beforeStep.stopReason, "fenced");

  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const afterDispatch = recordingDispatch({
    hold: async () => { entered.resolve(); await gate.promise; },
  });
  const after = makeRunner({ dispatch: afterDispatch });
  const afterRun = await after.runner.create(after.ids.uuid(), idleRun(chainedUnits()));
  await after.runner.apply(afterRun.id, startCommand(afterRun, [IDS.u1], after.ids.uuid()));
  const pumping = after.runner.pump(afterRun.id);
  await entered.promise;
  const afterCancel = waitForState(after.runner, run => run.state.status === "cancelled");
  await after.runner.apply(afterRun.id, cancelCommand(after.runner.getRun(afterRun.id), after.ids.uuid()));
  await afterCancel;
  gate.resolve();
  const late = await pumping;
  assert.equal(afterDispatch.calls, 1);
  assert.equal(late.stopReason, "cancelled");
  const unit = after.runner.getRun(afterRun.id).units.find(row => row.id === IDS.u1);
  assert.equal(unit?.status, "cancelled");
  const retained = after.runner.getSnapshot(afterRun.id).effects[0];
  assert.ok(retained);
  assert.notEqual(retained.state, "intent");
  assert.notEqual(after.runner.getRun(afterRun.id).state.status, "completed");

  const quotaReplies: ProviderDispatchResult[] = [];
  const quotaDispatch = recordingDispatch({
    reply: async (request) => {
      if (quotaDispatch.calls > 1) {
        quotaReplies.push({ kind: "quota" });
        return { kind: "quota" };
      }
      return {
        kind: "succeeded",
        artifact: { artifactId: request.effectId, hash: hashSchema.parse(HASH.out1), bytes: 8 },
        usage: { knownInputUsage: null, knownOutputUsage: null },
      };
    },
  });
  const quota = makeRunner({ dispatch: quotaDispatch });
  const quotaRun = await quota.runner.create(quota.ids.uuid(), idleRun(chainedUnits()));
  await quota.runner.apply(quotaRun.id, startCommand(quotaRun, [IDS.u1, IDS.u2], quota.ids.uuid()));
  await quota.runner.pump(quotaRun.id);
  const quotaStep = await quota.runner.pump(quotaRun.id);
  assert.equal(quotaStep.stopReason, "paused-quota");
  assert.equal(quota.runner.getRun(quotaRun.id).state.status, "paused");
  const quotaAgain = await quota.runner.pump(quotaRun.id);
  assert.equal(quotaAgain.dispatched, 0);
  assert.equal(quotaDispatch.calls, 2);

  const tight = {
    ...seeded.limits,
    run: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
    chapter: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
  };
  const budget = makeRunner();
  const budgetRun = await budget.runner.create(budget.ids.uuid(), { ...idleRun(chainedUnits()), limits: tight });
  await budget.runner.apply(budgetRun.id, startCommand(budget.runner.getRun(budgetRun.id), [IDS.u1, IDS.u2], budget.ids.uuid(), tight));
  const spent = await budget.runner.pump(budgetRun.id);
  assert.equal(spent.stopReason, "unit-ready");
  assert.equal(budget.dispatch.calls, 1);
  const exhausted = await budget.runner.pump(budgetRun.id);
  assert.equal(exhausted.dispatched, 0);
  assert.equal(exhausted.stopReason, "paused-budget");
  assert.equal(budget.runner.getRun(budgetRun.id).state.status, "paused");
  if (budget.runner.getRun(budgetRun.id).state.status === "paused") {
    assert.equal(budget.runner.getRun(budgetRun.id).state.reason, "budget");
  }
  assert.notEqual(budget.runner.getRun(budgetRun.id).state.status, "completed");
  assert.equal(budget.dispatch.calls, 1);
});
