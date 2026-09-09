import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductionRunner } from "../../harness/src/index.js";
import { productionDocument } from "../../harness/test/fixtures.js";
import { HASH, listenApp, planCreateBody, studioHeaders, twoSceneScript } from "./harness-http-fixtures.js";
import { cancelCommand, productionCapability, recordingDispatch } from "./harness-runner-fixtures.js";
import {
  httpFixtureDispatch, matrixCounts, scriptedDispatch, startScopedRun, waitStatus, waitStep, withSqliteEnv,
} from "./harness-recovery-fixtures.js";

function assertNoDuplicates(counts: ReturnType<typeof matrixCounts>, effects: number, calls: number): void {
  assert.equal(counts.effects, effects);
  assert.equal(counts.providerCalls, calls);
  assert.equal(counts.intent, 0);
}

test("queued-save/apply", async () => {
  await withSqliteEnv({}, async ({ runner, dispatch, ids }) => {
    const run = await startScopedRun(runner, ids);
    const stepped = waitStep(runner, "unit-ready");
    const receipt = await runner.pump(run.id);
    assert.equal((await stepped).stopReason, "unit-ready");
    assert.equal(receipt.dispatched, 1);
    const counts = matrixCounts(runner, run.id, dispatch.calls);
    assertNoDuplicates(counts, 1, 1);
    assert.equal(counts.succeeded, 1);
    assert.equal(counts.ready, 1);
  });
});

test("commit-before-UI crash", async () => {
  await withSqliteEnv({}, async ({ store, runner, dispatch, ids, clock, counter }) => {
    const run = await startScopedRun(runner, ids);
    await runner.pump(run.id);
    assert.equal(matrixCounts(runner, run.id, dispatch.calls).succeeded, 1);
    clock.advance(30_000);
    const restarted = createProductionRunner({
      store, dispatch, clock, ids, capability: productionCapability(), counter,
    });
    const paused = waitStatus(restarted, "paused");
    restarted.recover(clock.now());
    await paused;
    const fenced = await restarted.pump(run.id);
    assert.equal(fenced.dispatched, 0);
    const counts = matrixCounts(restarted, run.id, dispatch.calls);
    assertNoDuplicates(counts, 1, 1);
    assert.equal(counts.ready, 1);
    assert.equal(counts.reason, "interrupted");
    assert.notEqual(counts.status, "running");
  });
});

test("duplicate-after-undo", async () => {
  await withSqliteEnv({}, async ({ runner, dispatch, ids }) => {
    const run = await startScopedRun(runner, ids);
    const command = cancelCommand(runner.getRun(run.id), ids.uuid());
    const first = await runner.apply(run.id, command);
    const second = await runner.apply(run.id, command);
    assert.equal(first.version, second.version);
    assert.equal(dispatch.calls, 0);
    assertNoDuplicates(matrixCounts(runner, run.id, dispatch.calls), 0, 0);
  });
});

test("restored lineage", async () => {
  await withSqliteEnv({}, async ({ app, ids, dispatch }) => {
    const createdPlan = planCreateBody(ids.uuid());
    const body = {
      requestId: createdPlan.requestId, sourceHead: createdPlan.sourceHead, script: twoSceneScript,
      productionDocument, limits: createdPlan.limits, tokenPolicy: createdPlan.tokenPolicy,
      initialScope: "imported-draft",
      importedCandidateSeed: {
        productionDocument, scenes: twoSceneScript.scenes, reviews: [], assetManifest: [], provenance: "imported",
      },
      archiveHash: HASH.a,
    };
    const { origin, close } = await listenApp(app);
    try {
      const created = await fetch(`${origin}/api/harness/runs`, {
        method: "POST", headers: studioHeaders, body: JSON.stringify(body),
      });
      assert.equal(created.status, 202);
      const payload = await created.json() as { run: { id: string; state: { status: string } } };
      assert.equal(payload.run.state.status, "idle");
      assert.equal(dispatch.calls, 0);
    } finally { await close(); }
  });
});

test("expired lease", async () => {
  await withSqliteEnv({}, async ({ runner, dispatch, ids, clock }) => {
    const run = await startScopedRun(runner, ids);
    await runner.pump(run.id);
    clock.advance(30_000);
    const paused = waitStatus(runner, "paused");
    runner.recover(clock.now());
    await paused;
    const again = await runner.pump(run.id);
    assert.equal(again.dispatched, 0);
    const counts = matrixCounts(runner, run.id, dispatch.calls);
    assertNoDuplicates(counts, 1, 1);
    assert.equal(counts.reason, "interrupted");
  });
});

test("auth refresh", async () => {
  const script = { mode: "success" as const };
  const clock = { now: () => 0 };
  const http = await httpFixtureDispatch(script, clock, {
    expires: -1,
    refresh: async () => ({ access_token: "rotated", expires_in: 3600 }),
  });
  try {
    await withSqliteEnv({ dispatch: http.dispatch }, async ({ runner, ids }) => {
      const run = await startScopedRun(runner, ids);
      const stepped = waitStep(runner, "unit-ready");
      await runner.pump(run.id);
      await stepped;
      const counts = matrixCounts(runner, run.id, http.dispatch.calls);
      assertNoDuplicates(counts, 1, 1);
      assert.equal(counts.succeeded, 1);
      assert.equal(http.refreshes(), 1);
      assert.equal(http.httpRequests(), 1);
    });
  } finally { await http.close(); }
});

test("429", async () => {
  const script = { mode: "quota" as const };
  const http = await httpFixtureDispatch(script, { now: () => 0 }, { expires: 60_000 });
  try {
    await withSqliteEnv({ dispatch: http.dispatch }, async ({ runner, ids }) => {
      const run = await startScopedRun(runner, ids);
      const stepped = waitStep(runner, "paused-quota");
      await runner.pump(run.id);
      await stepped;
      const extra = await runner.pump(run.id);
      assert.equal(extra.dispatched, 0);
      const counts = matrixCounts(runner, run.id, http.dispatch.calls);
      assertNoDuplicates(counts, 1, 1);
      assert.equal(counts.failed, 1);
      assert.equal(counts.reason, "quota");
    });
  } finally { await http.close(); }
});

test("stream disconnect", async () => {
  const script = { mode: "disconnect" as const };
  const http = await httpFixtureDispatch(script, { now: () => 0 }, { expires: 60_000 });
  try {
    await withSqliteEnv({ dispatch: http.dispatch }, async ({ runner, ids }) => {
      const run = await startScopedRun(runner, ids);
      const stepped = waitStep(runner, "paused-unknown-effect");
      await runner.pump(run.id);
      await stepped;
      const extra = await runner.pump(run.id);
      assert.equal(extra.dispatched, 0);
      const counts = matrixCounts(runner, run.id, http.dispatch.calls);
      assertNoDuplicates(counts, 1, 1);
      assert.equal(counts.unknown, 1);
      assert.equal(counts.reason, "unknown-effect");
    });
  } finally { await http.close(); }
});

test("cancel-before-dispatch", async () => {
  await withSqliteEnv({}, async ({ runner, dispatch, ids }) => {
    const run = await startScopedRun(runner, ids);
    const cancelled = waitStatus(runner, "cancelled");
    await runner.apply(run.id, cancelCommand(runner.getRun(run.id), ids.uuid()));
    await cancelled;
    const step = await runner.pump(run.id);
    assert.equal(step.dispatched, 0);
    assertNoDuplicates(matrixCounts(runner, run.id, dispatch.calls), 0, 0);
  });
});

test("cancel-after-dispatch", async () => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const dispatch = recordingDispatch({ hold: async () => { entered.resolve(); await gate.promise; } });
  await withSqliteEnv({ dispatch }, async ({ runner, ids }) => {
    const run = await startScopedRun(runner, ids);
    const pumping = runner.pump(run.id);
    await entered.promise;
    const cancelled = waitStatus(runner, "cancelled");
    await runner.apply(run.id, cancelCommand(runner.getRun(run.id), ids.uuid()));
    await cancelled;
    gate.resolve();
    const late = await pumping;
    assert.equal(late.stopReason, "cancelled");
    const counts = matrixCounts(runner, run.id, dispatch.calls);
    assert.equal(counts.effects, 1);
    assert.equal(counts.intent, 0);
    assert.equal(counts.providerCalls, 1);
  });
});

test("unknown response", async () => {
  const dispatch = scriptedDispatch(async () => ({ kind: "unknown", reason: "upstream" }));
  await withSqliteEnv({ dispatch }, async ({ runner, ids }) => {
    const run = await startScopedRun(runner, ids);
    const stepped = waitStep(runner, "paused-unknown-effect");
    await runner.pump(run.id);
    await stepped;
    const extra = await runner.pump(run.id);
    assert.equal(extra.dispatched, 0);
    const counts = matrixCounts(runner, run.id, dispatch.calls);
    assertNoDuplicates(counts, 1, 1);
    assert.equal(counts.unknown, 1);
  });
});
