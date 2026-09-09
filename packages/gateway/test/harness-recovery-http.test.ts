import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BUDGET_LIMITS } from "../../harness/src/index.js";
import { head, productionDocument, uuid as fixtureUuid } from "../../harness/test/fixtures.js";
import { HASH, IDS, jsonRequest, readyUnit, seedIdle, twoSceneScript } from "./harness-http-fixtures.js";
import { pendingUnit, startCommand } from "./harness-runner-fixtures.js";
import {
  countingCounter, idleRun, matrixCounts, scriptedDispatch, startScopedRun, withSqliteEnv,
} from "./harness-recovery-fixtures.js";

function decisionBody(kind: "applied" | "rejected", requestId: string, digest = HASH.a) {
  return {
    requestId,
    decisionReceipt: {
      receiptId: fixtureUuid, projectId: "project-legacy", lineageId: fixtureUuid, proposalId: fixtureUuid,
      proposalDigest: digest, kind, baseHead: head,
      resultHead: kind === "applied" ? { ...head, revision: 5 } : null,
      createdAt: "2026-09-09T00:00:00.000Z",
    },
  };
}

test("r2-reject-accept-race", async () => {
  await withSqliteEnv({}, async ({ app, store, ids, harness, dispatch }) => {
    const run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
    harness.remember(run.id, twoSceneScript, productionDocument);
    const rejected = await jsonRequest(app, `/api/harness/runs/${run.id}/rejected`, {
      method: "POST", body: JSON.stringify(decisionBody("rejected", ids.uuid())),
    });
    assert.equal(rejected.status, 200);
    const accepted = await jsonRequest(app, `/api/harness/runs/${run.id}/applied`, {
      method: "POST", body: JSON.stringify(decisionBody("applied", ids.uuid())),
    });
    assert.equal(accepted.status, 409);
    assert.equal(accepted.body["code"], "DECISION_CONFLICT");
    assert.equal(dispatch.calls, 0);
  });
});

test("r2-duplicate-control", async () => {
  await withSqliteEnv({}, async ({ app, store, ids, harness, dispatch }) => {
    const run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
    harness.remember(run.id, twoSceneScript, productionDocument);
    const first = await jsonRequest(app, `/api/harness/runs/${run.id}/applied`, {
      method: "POST", body: JSON.stringify(decisionBody("applied", ids.uuid())),
    });
    const second = await jsonRequest(app, `/api/harness/runs/${run.id}/applied`, {
      method: "POST", body: JSON.stringify(decisionBody("applied", ids.uuid())),
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body["receiptId"], second.body["receiptId"]);
    const conflict = await jsonRequest(app, `/api/harness/runs/${run.id}/applied`, {
      method: "POST", body: JSON.stringify(decisionBody("applied", ids.uuid(), HASH.b)),
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body["code"], "ID_PAYLOAD_CONFLICT");
    assert.equal(dispatch.calls, 0);
  });
});

test("r4-count-unsupported", async () => {
  const counter = countingCounter({ count: () => ({ kind: "unsupported" }) });
  await withSqliteEnv({ counter }, async ({ runner, dispatch, ids }) => {
    const run = await startScopedRun(runner, ids);
    const step = await runner.pump(run.id);
    assert.equal(step.dispatched, 0);
    assert.equal(step.stopReason, "paused-capability");
    const extra = await runner.pump(run.id);
    assert.equal(extra.dispatched, 0);
    const counts = matrixCounts(runner, run.id, dispatch.calls);
    assert.equal(counts.effects, 0);
    assert.equal(counts.providerCalls, 0);
    assert.equal(counts.reason, "capability");
    assert.equal(counter.calls, 1);
  });
});

test("r4-count-error", async () => {
  const counter = countingCounter({ count: () => ({ kind: "error", code: "quota" }) });
  await withSqliteEnv({ counter }, async ({ runner, dispatch, ids }) => {
    const run = await startScopedRun(runner, ids);
    const step = await runner.pump(run.id);
    assert.equal(step.dispatched, 0);
    assert.equal(step.stopReason, "paused-quota");
    const counts = matrixCounts(runner, run.id, dispatch.calls);
    assert.equal(counts.effects, 0);
    assert.equal(counts.providerCalls, 0);
    assert.equal(counts.reason, "quota");
    assert.notEqual(counts.reason, "capability");
  });
});

test("r4-limit-change", async () => {
  const tight = {
    ...DEFAULT_BUDGET_LIMITS,
    run: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
    chapter: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
  };
  await withSqliteEnv({}, async ({ runner, dispatch, ids }) => {
    const created = await runner.create(ids.uuid(), { ...idleRun([pendingUnit(IDS.u1, "outline", []), pendingUnit(IDS.u2, "scene-draft", [HASH.out1])]), limits: tight });
    await runner.apply(created.id, startCommand(runner.getRun(created.id), [IDS.u1, IDS.u2], ids.uuid(), tight));
    await runner.pump(created.id);
    const paused = await runner.pump(created.id);
    assert.equal(paused.stopReason, "paused-budget");
    const current = runner.getRun(created.id);
    await assert.rejects(() => runner.apply(current.id, {
      action: "budget", requestId: ids.uuid(), expectedRunVersion: current.version, expectedLimitVersion: current.limitVersion,
      limits: { ...tight, run: { textAttempts: 0, imageAttempts: 0, countRequests: 0 } }, tokenPolicy: "exact-only", reason: "shrink",
    }));
    const raised = await runner.apply(current.id, {
      action: "budget", requestId: ids.uuid(), expectedRunVersion: runner.getRun(current.id).version,
      expectedLimitVersion: runner.getRun(current.id).limitVersion, limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only", reason: "raise",
    });
    assert.equal(raised.state.status, "paused");
    const idlePump = await runner.pump(current.id);
    assert.equal(idlePump.dispatched, 0);
    assert.equal(dispatch.calls, 1);
  });
});

test("r5-unknown-reservation", async () => {
  const dispatch = scriptedDispatch(async () => ({ kind: "unknown", reason: "disconnected" }));
  await withSqliteEnv({ dispatch }, async ({ runner, ids }) => {
    const created = await runner.create(ids.uuid(), idleRun([pendingUnit(IDS.u1, "outline", [])]));
    await runner.apply(created.id, startCommand(created, [IDS.u1], ids.uuid()));
    await runner.pump(created.id);
    assert.equal(runner.getSnapshot(created.id).used.run.textAttempts, 1);
    const lost = runner.getSnapshot(created.id).effects[0];
    assert.equal(lost?.state, "unknown");
    const child = await runner.apply(created.id, {
      action: "repropose", requestId: ids.uuid(), expectedRunVersion: runner.getRun(created.id).version,
      analysisId: ids.uuid(), analysisDigest: HASH.a, newBaseHead: created.sourceHead,
      reuseUnitIds: [], reuseAssetIds: [], resolutions: [],
    });
    assert.equal(child.budgetGroupId, created.budgetGroupId);
    assert.equal(child.budgetOwnerRunId, created.id);
    await runner.apply(child.id, startCommand(child, [IDS.u1], ids.uuid(), {
      ...DEFAULT_BUDGET_LIMITS, run: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
      chapter: { textAttempts: 1, imageAttempts: 0, countRequests: 0 },
    }));
    const blocked = await runner.pump(child.id);
    assert.equal(blocked.dispatched, 0);
    assert.equal(dispatch.calls, 1);
    assert.equal(runner.getSnapshot(created.id).used.run.textAttempts, 1);
    assert.equal(runner.getSnapshot(created.id).effects.length, 1);
  });
});

test("r5-cache-provenance", async () => {
  await withSqliteEnv({}, async ({ app, store, ids, harness, dispatch, runner }) => {
    const run = await startScopedRun(runner, ids, [pendingUnit(IDS.u1, "outline", [])]);
    await runner.pump(run.id);
    const ready = runner.getRun(run.id).units[0];
    assert.equal(ready?.status, "ready");
    if (ready?.status === "ready") {
      assert.equal(ready.provenance.originHead.projectId, run.sourceHead.projectId);
      assert.equal(ready.provenance.reusedFrom, undefined);
    }
    harness.remember(run.id, twoSceneScript, productionDocument);
    const analysis = await jsonRequest(app, `/api/harness/runs/${run.id}/reuse-analysis`, {
      method: "POST",
      body: JSON.stringify({
        requestId: ids.uuid(), expectedRunVersion: runner.getRun(run.id).version, sourceProposalId: IDS.candidate,
        sourceDigest: HASH.a, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
        script: {
          ...twoSceneScript,
          scenes: [twoSceneScript.scenes[0], { id: "ch02", background: "title", lines: [{ id: "l-b", speaker: null, text: "Changed" }], ending: "End" }],
        },
        productionDocument,
      }),
    });
    assert.equal(analysis.status, 200);
    const units = analysis.body["units"] as readonly { classification: string }[];
    assert.equal(units[0]?.classification, "eligible");
    assert.equal(dispatch.calls, 1);
  });
});

test("preview-boundary-not-ending", async () => {
  await withSqliteEnv({}, async ({ app, store, ids, harness, dispatch }) => {
    const run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
    const script = {
      ...twoSceneScript,
      scenes: [{ id: "start", background: "title", lines: [{ id: "l-a", speaker: null, text: "Hello" }], next: "ch02-arrival" }],
    };
    const document = {
      ...productionDocument,
      outline: {
        ...productionDocument.outline,
        scenes: [
          { id: "start", chapter: "1장", title: "시작", summary: "입구", artDirection: "없음", targetMinutes: 2, background: "title", next: "ch02-arrival" },
          { id: "ch02-arrival", chapter: "2장", title: "도착", summary: "미작성", artDirection: "없음", targetMinutes: 2, background: "title", ending: "끝" },
        ],
      },
    };
    harness.remember(run.id, script, document);
    const preview = await jsonRequest(app, `/api/harness/runs/${run.id}/previews`, {
      method: "POST",
      body: JSON.stringify({
        requestId: ids.uuid(), expectedCandidateRevision: 0, entry: { kind: "from-start", sceneId: "start" },
        allowMissingAssetPlaceholders: false,
      }),
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body["kind"], "candidate-preview");
    const boundaries = preview.body["boundaries"] as readonly { reason: string; targetSceneId: string }[];
    assert.equal(boundaries.length, 1);
    assert.equal(boundaries[0]?.reason, "unwritten-scene");
    assert.equal(boundaries[0]?.targetSceneId, "ch02-arrival");
    const scenes = preview.body["materializedScenes"];
    assert.ok(Array.isArray(scenes));
    const first = scenes[0];
    assert.equal(typeof first === "object" && first !== null && "ending" in first, false);
    assert.equal(dispatch.calls, 0);
  });
});
