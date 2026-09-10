import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, parseToolEnvelope, toolResultSchema, unitIdSchema, writeSetSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import {
  branchSectionHash, canonDataSchema, expectedBindingCatalogRead, inspectFixture, secondCallId,
} from "./operations-inspect-fixture.js";

test("read_canon returns CanonSection values, fact truth and predicates, and reference versions", async () => {
  // Given
  const f = await inspectFixture();
  const before = structuredClone(f.input.candidate);
  const expectedBindings = await expectedBindingCatalogRead(f.bindings);
  const sectionIds = ["castCanon", "worldTimeline", "branchFacts", "artDirection", "outline"];
  const envelope = parseToolEnvelope({ ...f.common, tool: "read_canon", arguments: { sectionIds } });
  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });
  // Then
  assert.equal(outcome.result.ok, true);
  toolResultSchema.parse(outcome.result);
  const data = canonDataSchema.parse(outcome.result.data);
  assert.deepEqual(data.sourceHead, f.input.sourceHead);
  assert.deepEqual(data.candidateRef, before.ref);
  assert.deepEqual(data.sections.map(section => section.sectionId), sectionIds);
  const document = before.productionDocument;
  const values = [
    { kind: "entries", entries: document.castCanon },
    { kind: "entries", entries: document.worldTimeline },
    { kind: "entries", entries: document.branchFacts },
    { kind: "art-direction", rules: document.artDirection },
    { kind: "outline", outline: document.outline },
  ];
  assert.deepEqual(data.sections.map(section => section.value), values);
  assert.deepEqual(data.sections.map(section => section.sourceHash), await Promise.all(values.map(canonicalHash)));
  assert.deepEqual(data.facts.find(row => row.entry.id === f.fact.id), {
    sectionId: "branchFacts", entry: f.fact,
    sourceHead: f.input.sourceHead, sourceHash: await canonicalHash(f.fact),
  });
  assert.deepEqual(data.referenceBindings, f.bindings);
  assert.deepEqual(outcome.result.readSet.filter(read => read.kind === "query" &&
    read.query === expectedBindings.query), [expectedBindings]);
  assert.equal(outcome.result.readSet.some(read => read.kind === "entity" && read.target.kind === "asset"), false);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  assert.strictEqual(outcome.candidate, f.input.candidate);
  assert.deepEqual(f.input.candidate, before);
});

test("fact filtering stays inside requested sections and records full wrapper hashes", async () => {
  // Given
  const f = await inspectFixture();
  const expectedBindings = await expectedBindingCatalogRead(f.bindings);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "read_canon",
    arguments: { sectionIds: ["branchFacts"], factIds: [f.fact.id] },
  });
  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });
  // Then
  assert.equal(outcome.result.ok, true);
  const data = canonDataSchema.parse(outcome.result.data);
  assert.deepEqual(data.sections.map(row => row.sectionId), ["branchFacts"]);
  assert.deepEqual(data.facts.map(row => row.entry), [f.fact]);
  assert.deepEqual(data.sections[0]?.value, { kind: "entries", entries: [f.fact] });
  const sectionRead = outcome.result.readSet.find(read => read.kind === "entity" &&
    read.target.kind === "canon" && read.target.sectionId === "branchFacts" && read.target.entryId === undefined);
  assert.equal(sectionRead?.hash, await branchSectionHash(f));
  assert.ok(outcome.result.readSet.some(read => read.kind === "entity" &&
    read.target.kind === "canon" && read.target.entryId === f.fact.id &&
    read.hash === data.facts[0]?.sourceHash));
  assert.equal(outcome.result.readSet.some(read => read.kind === "entity" &&
    (read.target.kind === "project" || read.target.kind === "scene" || read.target.kind === "asset" ||
      read.target.kind === "canon" && read.target.sectionId !== "branchFacts")), false);
  assert.deepEqual(data.referenceBindings, f.bindings);
  assert.deepEqual(outcome.result.readSet.filter(read => read.kind === "query" &&
    read.query === expectedBindings.query), [expectedBindings]);
});

test("proposed canon from another unit is not promoted by inspection", async () => {
  // Given a journaled proposal from a distinct unit, not an approved document change.
  const f = await inspectFixture();
  const proposal = parseToolEnvelope({
    ...f.common, tool: "propose_canon", arguments: {
      sectionId: "branchFacts", expectedSectionHash: await branchSectionHash(f),
      replacement: { kind: "entries", entries: [{ ...f.fact, text: "Unapproved claim" }] },
      reason: "Review a changed fact",
    },
  });
  const proposed = await applyCandidateTool({
    ...f.input, envelope: proposal, unitId: unitIdSchema.parse(secondCallId),
    authorizedWriteSet: writeSetSchema.parse([{ target: { kind: "canon", sectionId: "branchFacts" }, fields: ["proposal"] }]),
  });
  assert.equal(proposed.result.ok, true);
  const envelope = parseToolEnvelope({
    ...f.common, callId: secondCallId, tool: "read_canon", arguments: { sectionIds: ["branchFacts"] },
  });
  // When
  const outcome = await applyCandidateTool({
    ...f.input, journal: proposed.journal, candidate: proposed.candidate, envelope,
  });
  // Then
  assert.equal(outcome.result.ok, true);
  assert.deepEqual(canonDataSchema.parse(outcome.result.data).facts.map(row => row.entry), [f.fact]);
  assert.equal(JSON.stringify(outcome.result.data).includes("Unapproved claim"), false);
  assert.equal(outcome.candidate.ref.revision, f.input.candidate.ref.revision);
});
