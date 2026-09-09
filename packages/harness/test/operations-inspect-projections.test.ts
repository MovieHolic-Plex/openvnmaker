import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson, parseProductionDocument, parseToolEnvelope, scriptSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { replayInspectionQuery } from "../src/operations-inspect.js";
import { canonDataSchema, inspectFixture, overviewDataSchema, secondCallId } from "./operations-inspect-fixture.js";

test("filtered canon values retain the hash of the complete approved section wrapper", async () => {
  // Given two approved facts but only one requested fact.
  const f = await inspectFixture();
  const entries = [f.fact, { ...f.fact, id: "unselected", text: "Other approved fact" }];
  const candidate = { ...f.input.candidate, productionDocument: parseProductionDocument({
    ...f.input.candidate.productionDocument, branchFacts: entries,
  }) };
  const envelope = parseToolEnvelope({ ...f.common, tool: "read_canon",
    arguments: { sectionIds: ["branchFacts"], factIds: [f.fact.id] } });
  // When
  const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });
  // Then
  assert.equal(outcome.result.ok, true);
  const data = canonDataSchema.parse(outcome.result.data);
  assert.deepEqual(data.sections[0]?.value, { kind: "entries", entries: [f.fact] });
  assert.equal(data.sections[0]?.sourceHash, await canonicalHash({ kind: "entries", entries }));
  assert.notEqual(data.sections[0]?.sourceHash, await canonicalHash(data.sections[0]?.value));
  assert.deepEqual(data.facts.map(fact => fact.entry.id), [f.fact.id]);
  assert.equal(outcome.result.readSet.some(read => read.kind === "entity" &&
    read.target.kind === "canon" && read.target.entryId === "unselected"), false);
});

test("an explicit empty fact selection returns no facts without inventing an empty section version", async () => {
  // Given
  const f = await inspectFixture();
  const envelope = parseToolEnvelope({ ...f.common, tool: "read_canon",
    arguments: { sectionIds: ["branchFacts"], factIds: [] } });
  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });
  // Then
  assert.equal(outcome.result.ok, true);
  const data = canonDataSchema.parse(outcome.result.data);
  assert.deepEqual(data.facts, []);
  assert.deepEqual(data.sections[0]?.value, { kind: "entries", entries: [] });
  assert.equal(data.sections[0]?.sourceHash, await canonicalHash({ kind: "entries", entries: [f.fact] }));
});

test("overview shows an approved unmaterialized beat without inventing manuscript lines", async () => {
  // Given a plan beat that is not yet in the candidate script.
  const f = await inspectFixture();
  const document = f.input.candidate.productionDocument;
  const candidate = { ...f.input.candidate, productionDocument: parseProductionDocument({
    ...document, outline: { ...document.outline, scenes: [{
      id: "future", title: "Future beat", chapter: "Final chapter", summary: "Planned arrival",
      artDirection: "Quiet", targetMinutes: 5, background: "title", ending: "Planned ending",
    }, ...document.outline.scenes] },
  }) };
  const envelope = parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: {} });
  // When
  const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });
  // Then
  assert.equal(outcome.result.ok, true);
  const data = overviewDataSchema.parse(outcome.result.data);
  assert.equal(data.graph.length, 43);
  assert.deepEqual(data.graph.find(row => row.sceneId === "future"), {
    sceneId: "future", materialized: false, targetSceneIds: [],
  });
  assert.equal(data.scenes.length, 20);
  assert.strictEqual(outcome.candidate, candidate);
  assert.equal(candidate.script.scenes.some(scene => scene.id === "future"), false);
});

test("overview rejects an authority-valid cursor beyond the available catalog", async () => {
  // Given a real cursor; only its offset is changed, not its authority digest.
  const f = await inspectFixture();
  const first = await applyCandidateTool({ ...f.input,
    envelope: parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: { limit: 1 } }),
  });
  assert.equal(first.result.ok, true);
  const cursor = overviewDataSchema.parse(first.result.data).nextCursor;
  assert.ok(cursor);
  const envelope = parseToolEnvelope({ ...f.common, callId: secondCallId, tool: "project_overview",
    arguments: { cursor: `${cursor.split(":")[0]}:42` } });
  // When
  const outcome = await applyCandidateTool({ ...f.input, journal: first.journal, envelope });
  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_INPUT");
  assert.strictEqual(outcome.candidate, f.input.candidate);
});

test("overview projection replay ignores unread manuscript text but preserves exact query evidence", async () => {
  // Given a real overview receipt and text-only edits with no graph or count changes.
  const f = await inspectFixture();
  const first = await applyCandidateTool({ ...f.input,
    envelope: parseToolEnvelope({ ...f.common, tool: "project_overview", arguments: { limit: 1 } }),
  });
  assert.equal(first.result.ok, true);
  const query = canonicalJson({ kind: "inspection-project-overview", version: 1, offset: 0, limit: 1 });
  const recorded = first.result.readSet.find(read => read.kind === "query" && read.query === query);
  assert.ok(recorded);
  const candidate = { ...f.input.candidate, script: scriptSchema.parse({ ...f.input.candidate.script,
    scenes: f.input.candidate.script.scenes.map(scene => ({ ...scene,
      lines: scene.lines.map(line => ({ ...line, text: "Changed unread text" })),
    })),
  }) };
  // When
  const replay = await replayInspectionQuery(candidate, recorded);
  // Then
  assert.equal(replay.kind, "current");
  assert.deepEqual(replay.current, recorded);
});
