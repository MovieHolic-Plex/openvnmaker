import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BUDGET_LIMITS, hashSchema } from "../../harness/src/index.js";
import { uuid as fixtureUuid } from "../../harness/test/fixtures.js";
import {
  HASH, IDS, jsonRequest, listenApp, makeHarnessGateway, planCreateBody, readSseEvents, readyUnit,
  seedIdle, seedState, studioHeaders, twoSceneScript,
} from "./harness-http-fixtures.js";

test("api-stream-reconnect", async () => {
  const { app, dispatch, ids } = makeHarnessGateway();
  const { origin, close } = await listenApp(app);
  try {
    const created = await fetch(`${origin}/api/harness/runs`, {
      method: "POST", headers: studioHeaders, body: JSON.stringify(planCreateBody(ids.uuid())),
    });
    assert.equal(created.status, 202);
    const createdBody = await created.json() as { run: { id: string; version: number; state: { status: string } } };
    const runId = createdBody.run.id;
    const statusRes = await fetch(`${origin}/api/harness/runs/${runId}`, { headers: studioHeaders });
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json() as { state: { status: string }; lastEventSeq: number; sourceHead: { projectId: string } };
    assert.equal(status.state.status, "running");
    assert.equal(status.sourceHead.projectId, "project-legacy");
    const paused = await fetch(`${origin}/api/harness/runs/${runId}/pause`, {
      method: "POST", headers: studioHeaders,
      body: JSON.stringify({ requestId: ids.uuid(), expectedRunVersion: createdBody.run.version, reason: "user" }),
    });
    assert.equal(paused.status, 202);
    const firstRes = await fetch(`${origin}/api/harness/runs/${runId}/events?after=-1`, { headers: studioHeaders });
    assert.equal(firstRes.status, 200);
    const first = await readSseEvents(firstRes, 2);
    assert.ok(first.length >= 2);
    const replayRes = await fetch(`${origin}/api/harness/runs/${runId}/events?after=${first[0]?.seq ?? 0}`, { headers: studioHeaders });
    const replayed = await readSseEvents(replayRes, 1);
    assert.equal(replayed[0]?.seq, first[1]?.seq);
    assert.equal(dispatch.calls, 0);
  } finally { await close(); }
});

test("reject-origin-and-request-conflict", async () => {
  const { app, dispatch, ids } = makeHarnessGateway();
  const { origin, close } = await listenApp(app);
  const requestId = ids.uuid();
  const body = JSON.stringify(planCreateBody(requestId));
  try {
    const hostile = await fetch(`${origin}/api/harness/runs`, {
      method: "POST", headers: { ...studioHeaders, origin: "https://evil.example" }, body,
    });
    assert.equal(hostile.status, 403);
    const missing = await fetch(`${origin}/api/harness/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body,
    });
    assert.equal(missing.status, 403);
    const ok = await fetch(`${origin}/api/harness/runs`, { method: "POST", headers: studioHeaders, body });
    assert.equal(ok.status, 202);
    const conflict = await fetch(`${origin}/api/harness/runs`, {
      method: "POST", headers: studioHeaders, body: JSON.stringify(planCreateBody(requestId, { brief: "Other" })),
    });
    assert.equal(conflict.status, 409);
    assert.equal(dispatch.calls, 0);
  } finally { await close(); }
});

test("get-run-author-view-allowlist", async () => {
  const { app, ids } = makeHarnessGateway();
  const created = await jsonRequest(app, "/api/harness/runs", { method: "POST", body: JSON.stringify(planCreateBody(ids.uuid())) });
  assert.equal(created.status, 202);
  const run = created.body["run"] as Record<string, unknown>;
  const got = await jsonRequest(app, `/api/harness/runs/${String(run["id"])}`);
  assert.equal(got.status, 200);
  assert.equal(got.text.includes("oauth-provider-project-id"), false);
  assert.equal(got.text.includes("SECRET_THOUGHT"), false);
  assert.equal(got.text.includes("providerContinuation"), false);
  assert.equal((got.body["sourceHead"] as { projectId: string }).projectId, "project-legacy");
  assert.equal("ownerEpoch" in got.body, false);
  assert.equal("effects" in got.body, false);
});

const budget = { limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only" as const };
const rows = [
  { name: "create-imported-draft", setup: "none", path: "/runs", body: "imported", status: 202, run: "idle" },
  { name: "start-from-idle", setup: "idle", path: "/runs/:id/start", body: "start", status: 202, run: "running" },
  { name: "start-from-running", setup: "running", path: "/runs/:id/start", body: "start", status: 409, code: "INVALID_STATE" },
  { name: "approve-awaiting", setup: "awaiting-review", path: "/runs/:id/approve", body: "approve", status: 202, run: "idle" },
  { name: "approve-stale-review", setup: "awaiting-review", path: "/runs/:id/approve", body: "approve-stale", status: 409, code: "STALE_REVIEW" },
  { name: "request-changes", setup: "awaiting-review", path: "/runs/:id/request-changes", body: "changes", status: 202, run: "running" },
  { name: "pause-running", setup: "running", path: "/runs/:id/pause", body: "pause", status: 202, run: "paused" },
  { name: "pause-idle", setup: "idle", path: "/runs/:id/pause", body: "pause", status: 409, code: "INVALID_STATE" },
  { name: "resume-paused", setup: "paused-user", path: "/runs/:id/resume", body: "resume", status: 202, run: "running" },
  { name: "resume-stale-head", setup: "paused-user", path: "/runs/:id/resume", body: "resume-stale", status: 409, code: "REPROPOSE_REQUIRED" },
  { name: "budget-idle", setup: "idle", path: "/runs/:id/budget", body: "budget", status: 202 },
  { name: "retry-unknown", setup: "paused-unknown", path: "/runs/:id/retry-effect", body: "retry", status: 202 },
  { name: "cancel-running", setup: "running", path: "/runs/:id/cancel", body: "cancel", status: 202, run: "cancelled" },
  { name: "cancel-completed", setup: "completed", path: "/runs/:id/cancel", body: "cancel", status: 409, code: "INVALID_STATE" },
  { name: "preview", setup: "idle", path: "/runs/:id/previews", body: "preview", status: 200 },
  { name: "applied-ack", setup: "idle", path: "/runs/:id/applied", body: "applied", status: 200 },
  { name: "rejected-ack", setup: "idle", path: "/runs/:id/rejected", body: "rejected", status: 200 },
] as const;

for (const row of rows) {
  test(`command-transition-table: ${row.name}`, async () => {
    const { app, store, ids, runner, harness } = makeHarnessGateway();
    const requestId = ids.uuid();
    let runId = IDS.run;
    if (row.setup !== "none") {
      let run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
      runId = run.id;
      if (row.setup === "running") run = seedState(store, run, { status: "running" });
      if (row.setup === "awaiting-review") run = seedState(store, run, { status: "awaiting-review" });
      if (row.setup === "paused-user") run = seedState(store, run, { status: "paused", reason: "user" });
      if (row.setup === "paused-unknown") {
        run = seedState(store, run, { status: "paused", reason: "unknown-effect" });
        const snap = store.load(run.id);
        if (snap) store.save({
          ...snap,
          effects: [{
            effectId: fixtureUuid, payloadHash: hashSchema.parse(HASH.a), state: "unknown", reason: "disconnect",
            admission: snap.run.limits ? {
              requestPayloadHash: HASH.a, capabilityBindingHash: HASH.b, budgetGroupId: IDS.group, limitVersion: 0,
              textContextBytes: 1, wireBodyBytes: 1, images: [], countedInputTokens: 1, tokenWindowMode: "input-only",
              requestedOutputTokens: 1, tokenCheck: "pass", policy: "exact-only", allowed: true, reason: null,
              authorization: "exact-approved",
            } : undefined,
          } as never],
        });
      }
      if (row.setup === "completed") seedState(store, run, { status: "completed" });
      harness.remember(run.id, twoSceneScript, planCreateBody(requestId).productionDocument);
      void runner;
    }
    const path = row.path.replace(":id", runId);
    const res = await jsonRequest(app, `/api/harness${path}`, { method: "POST", body: JSON.stringify(commandBody(row.body, requestId, store, runId)) });
    assert.equal(res.status, row.status);
    if ("code" in row && row.code) assert.equal(res.body["code"], row.code);
    if ("run" in row && row.run) {
      const view = (res.body["run"] as { state?: { status?: string } } | undefined)?.state?.status
        ?? (await jsonRequest(app, `/api/harness/runs/${runId}`)).body["state"] as { status?: string } | undefined;
      const status = typeof view === "object" ? view?.status : view;
      assert.equal(status, row.run);
    }
  });
}

function commandBody(kind: string, requestId: string, store: ReturnType<typeof makeHarnessGateway>["store"], runId: string): unknown {
  const run = store.load(runId)?.run;
  const version = run?.version ?? 0;
  const base = { requestId, expectedRunVersion: version };
  switch (kind) {
    case "imported": {
      const created = planCreateBody(requestId);
      return {
        requestId, sourceHead: created.sourceHead, script: twoSceneScript, productionDocument: created.productionDocument,
        limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only", initialScope: "imported-draft",
        importedCandidateSeed: {
          productionDocument: created.productionDocument, scenes: twoSceneScript.scenes,
          reviews: [], assetManifest: [], provenance: "imported",
        }, archiveHash: HASH.a,
      };
    }
    case "start": return {
      ...base, scope: { kind: "chapter", chapterIds: ["ch1"], unitIds: [IDS.u1] }, reviewDigest: HASH.a, ...budget,
    };
    case "approve": return { ...base, stage: "plan", reviewId: fixtureUuid, reviewDigest: HASH.a, unitIds: [IDS.u1] };
    case "approve-stale": return { ...base, stage: "plan", reviewId: fixtureUuid, reviewDigest: HASH.b, unitIds: [IDS.u1] };
    case "changes": return { ...base, reviewId: fixtureUuid, reviewDigest: HASH.a, issueIds: [fixtureUuid], instruction: "repair", ...budget };
    case "pause": return { ...base, reason: "user" };
    case "resume": return { ...base, observedSourceHead: run?.sourceHead, capabilityBindingHash: HASH.a };
    case "resume-stale": {
      const sourceHead = run?.sourceHead;
      if (sourceHead === undefined) return base;
      return {
        ...base, observedSourceHead: { ...sourceHead, revision: sourceHead.revision + 1 },
        capabilityBindingHash: HASH.a,
      };
    }
    case "budget": return { ...base, ...budget, expectedLimitVersion: run?.limitVersion ?? 0, reason: "increase" };
    case "retry": return { ...base, effectId: fixtureUuid, payloadHash: HASH.a, authorizeReplacement: true };
    case "cancel": return { ...base, reason: "stop the run" };
    case "preview": return {
      requestId, expectedCandidateRevision: 0, entry: { kind: "from-start", sceneId: "start" },
      allowMissingAssetPlaceholders: false,
    };
    case "applied": return {
      requestId, decisionReceipt: {
        receiptId: fixtureUuid, projectId: "project-legacy", lineageId: fixtureUuid, proposalId: fixtureUuid,
        proposalDigest: HASH.a, kind: "applied", baseHead: run?.sourceHead, resultHead: { ...run?.sourceHead, revision: 5 },
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    };
    case "rejected": return {
      requestId, decisionReceipt: {
        receiptId: fixtureUuid, projectId: "project-legacy", lineageId: fixtureUuid, proposalId: fixtureUuid,
        proposalDigest: HASH.a, kind: "rejected", baseHead: run?.sourceHead, resultHead: null,
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    };
    default: return base;
  }
}
