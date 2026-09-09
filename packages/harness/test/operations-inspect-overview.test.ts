import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, parseToolEnvelope, revisionSchema, toolResultSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { applyInspectOperation } from "../src/operations-inspect.js";
import {
  branchSectionHash, expectedBindingCatalogRead, inspectFixture, overviewDataSchema, secondCallId,
} from "./operations-inspect-fixture.js";

test("inspection typed seam reaches a real structured overview assertion", async () => {
  // Given
  const f = await inspectFixture();
  const envelope = parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: {} });
  assert.equal(envelope.tool, "project_overview");
  // When
  const result = await applyInspectOperation({ ...f.input, envelope });
  // Then
  assert.equal(result.ok, true);
  const data = overviewDataSchema.parse(result.mutation.data);
  assert.equal(data.metadata.title, f.metadata.title);
  assert.deepEqual(result.mutation.writeSet, []);
});

test("overview returns actual metadata, compact graph, summary page and version evidence", async () => {
  // Given
  const f = await inspectFixture();
  const before = structuredClone(f.input.candidate);
  const expectedBindings = await expectedBindingCatalogRead(f.bindings);
  const envelope = parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: {} });
  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });
  // Then
  assert.equal(outcome.result.ok, true);
  toolResultSchema.parse(outcome.result);
  const data = overviewDataSchema.parse(outcome.result.data);
  assert.deepEqual(data.sourceHead, f.input.sourceHead);
  assert.deepEqual(data.candidateRef, before.ref);
  assert.deepEqual(data.metadata, f.metadata);
  assert.equal(data.graph.length, 42);
  assert.deepEqual(data.graph.find(row => row.sceneId === "start"), {
    sceneId: "start", targetSceneIds: ["end"], materialized: true,
  });
  assert.equal(data.scenes.length, 20);
  assert.deepEqual(data.scenes[0], {
    sceneId: "start", chapter: "First chapter", title: "Beat start",
    summary: "Approved summary start", lineCount: 1, choiceCount: 1, materialized: true,
  });
  assert.equal(typeof data.nextCursor, "string");
  assert.equal(data.canonVersions.find(row => row.sectionId === "branchFacts")?.hash,
    await branchSectionHash(f));
  assert.deepEqual(data.assetVersions, await Promise.all(f.bindings.map(async binding => ({
    binding, hash: await canonicalHash(binding),
  }))));
  assert.deepEqual(outcome.result.readSet.filter(read => read.kind === "query" &&
    read.query === expectedBindings.query), [expectedBindings]);
  assert.equal(outcome.result.readSet.some(read => read.kind === "entity" && read.target.kind === "asset"), false);
  // Bounded inspection must not become another whole-script reader.
  assert.equal(JSON.stringify(outcome.result.data).includes("Private manuscript"), false);
  assert.equal(Object.hasOwn(data.metadata, "nativeSaveId"), false);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  assert.strictEqual(outcome.candidate, f.input.candidate);
  assert.deepEqual(f.input.candidate, before);
  const canonRead = outcome.result.readSet.find(read => read.kind === "entity" &&
    read.target.kind === "canon" && read.target.sectionId === "branchFacts");
  assert.equal(canonRead?.hash, await branchSectionHash(f));
});

test("overview pages at forty without omission or duplication", async () => {
  // Given a successful first page and its continuation cursor.
  const f = await inspectFixture();
  const firstEnvelope = parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: { limit: 40 } });
  const first = await applyCandidateTool({ ...f.input, envelope: firstEnvelope });
  assert.equal(first.result.ok, true);
  const page = overviewDataSchema.parse(first.result.data);
  assert.equal(page.scenes.length, 40);
  assert.equal(typeof page.nextCursor, "string");
  const envelope = parseToolEnvelope({
    ...f.common, callId: secondCallId, tool: "project_overview",
    arguments: { cursor: page.nextCursor, limit: 40 },
  });
  // When
  const second = await applyCandidateTool({ ...f.input, journal: first.journal, envelope });
  // Then
  assert.equal(second.result.ok, true);
  const last = overviewDataSchema.parse(second.result.data);
  assert.equal(last.nextCursor, null);
  assert.equal(last.scenes.length, 2);
  assert.deepEqual([...page.scenes, ...last.scenes].map(row => row.sceneId),
    f.input.candidate.script.scenes.map(scene => scene.id));
  assert.equal(second.result.changed, false);
  assert.deepEqual(second.result.writeSet, []);
  assert.strictEqual(second.candidate, f.input.candidate);
});

const cursorAuthorities = [
  { name: "candidate revision", candidateRevision: 5, sourceRevision: 4 },
  { name: "trusted run origin", candidateRevision: 4, sourceRevision: 99 },
];
for (const authority of cursorAuthorities) {
  test(`overview cursor is bound to ${authority.name}`, async () => {
    // Given a cursor issued under the original authority.
    const f = await inspectFixture();
    const first = await applyCandidateTool({
      ...f.input,
      envelope: parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: { limit: 1 } }),
    });
    assert.equal(first.result.ok, true);
    const page = overviewDataSchema.parse(first.result.data);
    const candidate = { ...f.input.candidate,
      ref: { ...f.input.candidate.ref, revision: revisionSchema.parse(authority.candidateRevision) } };
    const envelope = parseToolEnvelope({
      ...f.common, callId: secondCallId, expectedCandidateRevision: authority.candidateRevision,
      tool: "project_overview", arguments: { cursor: page.nextCursor },
    });
    // When
    const outcome = await applyCandidateTool({
      ...f.input, journal: first.journal, envelope, candidate,
      sourceHead: { ...f.input.sourceHead, revision: revisionSchema.parse(authority.sourceRevision) },
    });
    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "STALE_HEAD");
    assert.strictEqual(outcome.candidate, candidate);
    assert.deepEqual(outcome.journal.calls.at(-1)?.result, outcome.result);
  });
}
