import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BUDGET_LIMITS } from "../../harness/src/index.js";
import { analyzeReuse, planReproposedCandidate } from "../src/harness/repropose.js";
import {
  HASH, IDS, jsonRequest, makeHarnessGateway, planCreateBody, readyUnit, seedIdle, twoSceneScript,
} from "./harness-http-fixtures.js";
import { head, productionDocument } from "../../harness/test/fixtures.js";

const changedOther = {
  ...twoSceneScript,
  scenes: [
    twoSceneScript.scenes[0],
    { id: "ch02", background: "title", lines: [{ id: "l-b", speaker: null, text: "Changed" }], ending: "End" },
  ],
} as const;
const changedStart = {
  ...twoSceneScript,
  scenes: [
    { id: "start", background: "title", lines: [{ id: "l-a", speaker: null, text: "Edited" }], next: "ch02" },
    twoSceneScript.scenes[1],
  ],
} as const;

test("zero-generation reuse analysis classifies unrelated scene edits as eligible", async () => {
  const units = [readyUnit(IDS.u1, "start")];
  const analysis = await analyzeReuse({
    runId: IDS.run, sourceHead: head, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
    currentScript: twoSceneScript, newScript: changedOther,
    currentDocument: productionDocument, newDocument: productionDocument,
    units, sourceProposalId: IDS.candidate, sourceDigest: HASH.a,
  });
  assert.equal(analysis.units[0]?.classification, "eligible");
  assert.equal(analysis.requiredRepairs.length, 0);
});

test("reuse analysis marks direct scene writes as conflict", async () => {
  const analysis = await analyzeReuse({
    runId: IDS.run, sourceHead: head, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
    currentScript: twoSceneScript, newScript: changedStart,
    currentDocument: productionDocument, newDocument: productionDocument,
    units: [readyUnit(IDS.u1, "start")], sourceProposalId: IDS.candidate, sourceDigest: HASH.a,
  });
  assert.equal(analysis.units[0]?.classification, "conflict");
});

test("reuse analysis marks pending units unavailable", async () => {
  const { store } = makeHarnessGateway();
  const run = seedIdle(store, [readyUnit(IDS.u1, "start")]);
  const pending = run.units.map(unit => ({ ...unit, status: "pending" as const }));
  const analysis = await analyzeReuse({
    runId: run.id, sourceHead: head, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
    currentScript: twoSceneScript, newScript: changedOther,
    currentDocument: productionDocument, newDocument: productionDocument,
    units: pending, sourceProposalId: IDS.candidate, sourceDigest: HASH.a,
  });
  assert.equal(analysis.units[0]?.classification, "unavailable");
});

test("planReproposedCandidate does not schedule generation", () => {
  const plan = planReproposedCandidate({
    reuseUnitIds: [IDS.u1], reuseAssetIds: [], resolutions: [],
    units: [{ unitId: IDS.u1, classification: "eligible", reasons: [], changedDependencies: [] }],
  });
  assert.equal(plan.scheduleGeneration, false);
  assert.deepEqual(plan.generationRequiredUnitIds, []);
});

test("http reuse-analysis does not dispatch", async () => {
  const { app, dispatch, store, ids } = makeHarnessGateway();
  const run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
  const res = await jsonRequest(app, `/api/harness/runs/${run.id}/reuse-analysis`, {
    method: "POST",
    body: JSON.stringify({
      requestId: ids.uuid(), expectedRunVersion: run.version, sourceProposalId: IDS.candidate,
      sourceDigest: HASH.a, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
      script: changedOther, productionDocument,
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(dispatch.calls, 0);
  const units = res.body["units"] as { classification: string }[];
  assert.equal(units[0]?.classification, "eligible");
});

test("http repropose reuses analysis without generation", async () => {
  const { app, dispatch, store, ids } = makeHarnessGateway();
  const run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
  const analysis = await jsonRequest(app, `/api/harness/runs/${run.id}/reuse-analysis`, {
    method: "POST",
    body: JSON.stringify({
      requestId: ids.uuid(), expectedRunVersion: run.version, sourceProposalId: IDS.candidate,
      sourceDigest: HASH.a, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
      script: changedOther, productionDocument,
    }),
  });
  const repropose = await jsonRequest(app, `/api/harness/runs/${run.id}/repropose`, {
    method: "POST",
    body: JSON.stringify({
      requestId: ids.uuid(), expectedRunVersion: run.version, analysisId: analysis.body["analysisId"],
      analysisDigest: analysis.body["analysisDigest"], newBaseHead: analysis.body["newBaseHead"],
      reuseUnitIds: [IDS.u1], reuseAssetIds: [], resolutions: [],
    }),
  });
  assert.equal(repropose.status, 202);
  assert.notEqual((repropose.body["run"] as { id: string }).id, run.id);
  assert.equal((repropose.body["run"] as { state: { status: string } }).state.status, "idle");
  assert.equal(dispatch.calls, 0);
});

test("reuse-analysis same requestId different body is 409", async () => {
  const { app, store, ids } = makeHarnessGateway();
  const run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
  const requestId = ids.uuid();
  const body = {
    requestId, expectedRunVersion: run.version, sourceProposalId: IDS.candidate,
    sourceDigest: HASH.a, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
    script: changedOther, productionDocument,
  };
  const first = await jsonRequest(app, `/api/harness/runs/${run.id}/reuse-analysis`, { method: "POST", body: JSON.stringify(body) });
  assert.equal(first.status, 200);
  const conflict = await jsonRequest(app, `/api/harness/runs/${run.id}/reuse-analysis`, {
    method: "POST", body: JSON.stringify({ ...body, sourceDigest: HASH.b }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body["code"], "ID_PAYLOAD_CONFLICT");
});

test("repropose rejects lineage mismatch and stale analysis", async () => {
  const { app, store, ids } = makeHarnessGateway();
  const run = seedIdle(store, [readyUnit(IDS.u1, "start")], ids.uuid());
  const mismatch = await jsonRequest(app, `/api/harness/runs/${run.id}/reuse-analysis`, {
    method: "POST",
    body: JSON.stringify({
      requestId: ids.uuid(), expectedRunVersion: run.version, sourceProposalId: IDS.candidate,
      sourceDigest: HASH.a,
      newBaseHead: { ...head, projectId: "other-project", revision: 5, scriptHash: HASH.c },
      script: changedOther, productionDocument, limits: DEFAULT_BUDGET_LIMITS,
    }),
  });
  assert.ok(mismatch.status === 400 || mismatch.status === 409);
  const analysis = await jsonRequest(app, `/api/harness/runs/${run.id}/reuse-analysis`, {
    method: "POST",
    body: JSON.stringify({
      requestId: ids.uuid(), expectedRunVersion: run.version, sourceProposalId: IDS.candidate,
      sourceDigest: HASH.a, newBaseHead: { ...head, revision: 5, scriptHash: HASH.c },
      script: changedOther, productionDocument,
    }),
  });
  const stale = await jsonRequest(app, `/api/harness/runs/${run.id}/repropose`, {
    method: "POST",
    body: JSON.stringify({
      requestId: ids.uuid(), expectedRunVersion: run.version, analysisId: analysis.body["analysisId"],
      analysisDigest: HASH.b, newBaseHead: analysis.body["newBaseHead"],
      reuseUnitIds: [IDS.u1], reuseAssetIds: [], resolutions: [],
    }),
  });
  assert.equal(stale.status, 409);
});
