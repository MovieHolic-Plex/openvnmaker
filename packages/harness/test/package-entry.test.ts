import assert from "node:assert/strict";
import test from "node:test";
import * as harness from "@vnmaker/harness";
import type {
  Candidate, CandidateToolInput, CandidateToolOutcome, OperationJournal,
  ContextSource, SceneContextResult, ContextDependencyReplay,
  ContextManifestInput, ContextManifestResult, BranchReadResult,
  BranchContextResult, ReferenceContextResult, SearchContextResult,
  OutlineDagResult, InspectionQueryReplay, PreviewSource, PreviewRequest,
  PreviewBuildResult,
} from "@vnmaker/harness";
import { head, productionDocument, script, uuid } from "./fixtures.js";

function fixture() {
  const candidate: Candidate = {
    ref: harness.candidateRefSchema.parse({ candidateId: uuid, revision: 4 }),
    script: harness.scriptSchema.parse({
      ...script, flags: { retained: false }, artDirection: "Muted light",
      musicFadeSeconds: 0.75, credits: [{ role: "Writer", names: "Fixture" }],
    }),
    productionDocument: harness.parseProductionDocument(productionDocument),
  };
  const source: ContextSource = {
    script: candidate.script, productionDocument: candidate.productionDocument,
    candidateRef: candidate.ref, sourceHead: harness.parseProjectHead(head),
  };
  return { candidate, source };
}

function input(candidate: Candidate, tool: { tool: string; arguments: object }): CandidateToolInput {
  const journal: OperationJournal = harness.operationJournalSchema.parse({
    candidateId: candidate.ref.candidateId, calls: [], allocations: [],
  });
  return {
    candidate, journal, sourceHead: harness.parseProjectHead(head),
    unitId: harness.unitIdSchema.parse(uuid),
    authorizedWriteSet: harness.writeSetSchema.parse([
      { target: { kind: "project" }, fields: ["title"] },
    ]),
    envelope: harness.parseToolEnvelope({
      callId: uuid, candidateId: candidate.ref.candidateId,
      expectedCandidateRevision: candidate.ref.revision, ...tool,
    }),
  };
}

test("package entry journals metadata edits and preserves candidate preimages", async () => {
  assert.equal(typeof harness.applyCandidateTool, "function");
  const { candidate } = fixture();
  const before = structuredClone(candidate);
  const { title, subtitle, start, artDirection, musicFadeSeconds, credits } = candidate.script;
  const expectedMetadataHash = await harness.canonicalHash({
    title, subtitle, start, artDirection, musicFadeSeconds, credits,
  });
  const request = input(candidate, { tool: "patch_project", arguments: {
    expectedMetadataHash, patch: { set: { title: "Revised title" }, unset: [] },
  } });
  const outcome: CandidateToolOutcome = await harness.applyCandidateTool(request);
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  assert.deepEqual(outcome.candidate.script, { ...before.script, title: "Revised title" });
  assert.deepEqual(outcome.candidate.productionDocument, before.productionDocument);
  assert.deepEqual(candidate, before);
  assert.equal(outcome.journal.calls.length, 1);
  assert.deepEqual(harness.operationJournalSchema.parse(outcome.journal), outcome.journal);
  assert.deepEqual(harness.operationReceiptSchema.parse(outcome.journal.calls[0]).result, outcome.result);
  const replay: CandidateToolOutcome = await harness.applyCandidateTool({
    ...request, candidate: outcome.candidate, journal: outcome.journal,
  });
  assert.deepEqual(replay, outcome);
  const noop = await harness.applyCandidateTool(input(candidate, { tool: "patch_project",
    arguments: { expectedMetadataHash, patch: { set: { title }, unset: [] } },
  }));
  assert.equal(noop.result.ok, true);
  assert.equal(noop.result.changed, false);
  assert.deepEqual(noop.result.writeSet, []);
  assert.strictEqual(noop.candidate, candidate);
});

test("package entry dispatches inspection and reconstructs metadata evidence", async () => {
  assert.equal(typeof harness.applyCandidateTool, "function");
  assert.equal(typeof harness.replayInspectionQuery, "function");
  const { candidate, source } = fixture();
  const before = structuredClone(candidate);
  for (const tool of [
    { tool: "project_overview", arguments: { limit: 1 } },
    { tool: "read_canon", arguments: { sectionIds: ["worldTimeline"] } },
  ]) {
    const outcome: CandidateToolOutcome = await harness.applyCandidateTool(input(candidate, tool));
    assert.equal(outcome.result.ok, true);
    assert.equal(outcome.result.changed, false);
    assert.deepEqual(outcome.result.writeSet, []);
    assert.strictEqual(outcome.candidate, candidate);
    const data = outcome.result.data;
    assert.ok(data !== null && typeof data === "object" && !Array.isArray(data));
    assert.deepEqual(data.sourceHead, source.sourceHead);
    assert.deepEqual(data.candidateRef, candidate.ref);
    assert.ok(outcome.result.readSet.length > 0);
    for (const recorded of outcome.result.readSet.filter(row => row.kind === "query")) {
      const replay: InspectionQueryReplay = await harness.replayInspectionQuery(candidate, recorded);
      assert.equal(replay.kind, "current");
      assert.deepEqual(replay.current, recorded);
    }
    if (tool.tool === "project_overview") {
      const overview = outcome.result.readSet.find(row => row.kind === "query" &&
        row.query === harness.canonicalJson({
          kind: "inspection-project-overview", version: 1, offset: 0, limit: 1,
        }));
      assert.ok(overview);
      const changed = await harness.replayInspectionQuery({ ...candidate,
        script: { ...candidate.script, title: "Changed metadata" },
      }, overview);
      assert.equal(changed.kind, "current");
      assert.notDeepEqual(changed.current, overview);
    }
  }
  assert.deepEqual(candidate, before);
});

test("package entry reads context, admits its manifest and replays typed evidence", async () => {
  assert.equal(typeof harness.readSceneContext, "function");
  const { source } = fixture();
  const before = structuredClone(source);
  const args = harness.toolArgumentsSchemas.read_scene.parse({ sceneId: "start", limit: 1 });
  const scene: SceneContextResult = await harness.readSceneContext(source, args);
  assert.equal(scene.kind, "ready");
  assert.deepEqual(scene.lines, source.script.scenes[0]?.lines);
  assert.equal(scene.sceneHash, await harness.canonicalHash(source.script.scenes[0]));
  assert.equal(scene.metadata.id, "start");
  const references: ReferenceContextResult = await harness.readReferenceContext(source, scene.window);
  assert.equal(references.kind, "ready");
  assert.deepEqual(references.referenceBindings, []);
  const selection = { sceneId: args.sceneId, maxVisitedStates: 4 };
  const branch: BranchReadResult = await harness.readBranchContext(source, selection);
  assert.equal(branch.kind, "ready");
  const applicability: BranchContextResult = harness.buildBranchContext({
    ...selection, script: source.script, facts: [],
  });
  assert.deepEqual(applicability, { kind: "ready", common: [], conditional: [] });
  const dag: OutlineDagResult = harness.validateOutlineDag(source.productionDocument.outline);
  assert.deepEqual(dag, { kind: "blocked", reason: "START_NOT_FOUND" });
  const search: SearchContextResult = await harness.searchContext(source,
    harness.toolArgumentsSchemas.search_content.parse({
      query: "Hello", kinds: ["line"], sceneId: "start", limit: 1,
    }));
  assert.equal(search.kind, "ready");
  assert.equal(search.hits.length, 1);
  const manifestInput: ContextManifestInput = {
    sourceHead: source.sourceHead, windows: [scene.window], facts: branch.facts,
    readSet: [...scene.readSet, ...branch.readSet, ...search.readSet, ...references.readSet],
    referenceBindingHashes: references.referenceBindingHashes, excluded: scene.excluded,
  };
  const manifest: ContextManifestResult = await harness.buildContextManifest(manifestInput);
  assert.equal(manifest.kind, "ready");
  assert.deepEqual(harness.contextManifestSchema.parse(manifest.manifest), manifest.manifest);
  const later: ContextSource = { ...source,
    sourceHead: harness.parseProjectHead({ ...source.sourceHead, revision: 5 }),
    candidateRef: harness.candidateRefSchema.parse({ ...source.candidateRef, revision: 5 }),
  };
  const replay: readonly ContextDependencyReplay[] =
    await harness.replayContextDependencies(later, manifestInput.readSet);
  assert.equal(replay.length, manifestInput.readSet.length);
  assert.ok(replay.length > 0);
  for (const [index, result] of replay.entries()) {
    assert.equal(result.kind, "unchanged");
    assert.deepEqual(result.recorded, manifestInput.readSet[index]);
    assert.deepEqual(result.current, result.recorded);
  }
  const stale = await harness.readSceneContext(source,
    harness.toolArgumentsSchemas.read_scene.parse({ sceneId: "start", afterLineId: "missing" }));
  assert.deepEqual(stale, { kind: "blocked", reason: "STALE_TARGET" });
  assert.deepEqual(source, before);
});

test("package entry builds a preview without mutation and rejects stale revisions", async () => {
  assert.equal(typeof harness.buildPreviewSnapshot, "function");
  const { candidate, source } = fixture();
  const previewSource: PreviewSource = {
    candidate, sourceHead: source.sourceHead, runId: harness.runIdSchema.parse(uuid),
    missingAssets: [], includedUnitHashes: [await harness.canonicalHash(candidate.script)],
  };
  const request: PreviewRequest = {
    previewId: uuid, expectedCandidateRevision: candidate.ref.revision,
    allowMissingAssetPlaceholders: false,
    entry: harness.previewEntrySchema.parse({ kind: "from-start", sceneId: "start" }),
  };
  const before = structuredClone(previewSource);
  const result: PreviewBuildResult = await harness.buildPreviewSnapshot(previewSource, request);
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.materializedScenes, candidate.script.scenes);
  assert.deepEqual(result.snapshot.initialFlags, { retained: false });
  assert.deepEqual(result.snapshot.sourceHead, source.sourceHead);
  assert.equal(result.snapshot.candidateRevision, 4);
  assert.deepEqual(harness.previewSnapshotSchema.parse(result.snapshot), result.snapshot);
  const { snapshotHash, ...content } = result.snapshot;
  assert.equal(snapshotHash, await harness.canonicalHash(content));
  assert.deepEqual(await harness.buildPreviewSnapshot(previewSource, {
    ...request, expectedCandidateRevision: harness.revisionSchema.parse(3),
  }), { ok: false, code: "STALE_HEAD" });
  assert.deepEqual(previewSource, before);
});
