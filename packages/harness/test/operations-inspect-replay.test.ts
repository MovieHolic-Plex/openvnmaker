import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, parseProductionDocument, revisionSchema } from "../src/index.js";
import type { ApprovedArtBinding } from "../src/index.js";
import { replayInspectionQuery } from "../src/operations-inspect.js";
import { expectedBindingCatalogRead, inspectFixture } from "./operations-inspect-fixture.js";

const catalogs: readonly {
  readonly name: string;
  readonly change: (bindings: readonly ApprovedArtBinding[]) => readonly ApprovedArtBinding[];
}[] = [
  { name: "reference-version metadata", change: bindings => bindings.map(binding => ({
    ...binding, referenceVersionIds: ["hero-v4"],
  })) },
  { name: "record order", change: bindings => [...bindings].reverse() },
  { name: "record removal", change: bindings => bindings.slice(1) },
  { name: "duplicate multiplicity", change: bindings => [...bindings, ...bindings] },
];
for (const catalog of catalogs) {
  test(`binding catalog replay detects changed ${catalog.name}`, async () => {
    // Given recorded evidence and a comparison candidate with changed approved bindings.
    const f = await inspectFixture();
    const recorded = await expectedBindingCatalogRead(f.bindings);
    const bindings = catalog.change(f.bindings);
    const candidate = { ...f.input.candidate, productionDocument: parseProductionDocument({
      ...f.input.candidate.productionDocument, referenceBindings: bindings,
    }) };
    const expected = await expectedBindingCatalogRead(bindings);
    // When
    const replay = await replayInspectionQuery(candidate, recorded);
    // Then
    assert.equal(replay.kind, "current");
    assert.deepEqual(replay.current, expected);
    assert.notEqual(replay.current.hash, recorded.hash);
  });
}

test("binding catalog replay preserves exact records while ignoring unrelated manuscript and revision", async () => {
  // Given
  const f = await inspectFixture();
  const recorded = await expectedBindingCatalogRead(f.bindings);
  const candidate = { ...f.input.candidate,
    script: { ...f.input.candidate.script, title: "Unrelated title" },
    ref: { ...f.input.candidate.ref, revision: revisionSchema.parse(5) } };
  // When
  const replay = await replayInspectionQuery(candidate, recorded);
  // Then
  assert.equal(replay.kind, "current");
  assert.deepEqual(replay.current, recorded);
  assert.equal(replay.current.resultIds.length, 3);
  assert.equal(replay.current.resultIds[0], replay.current.resultIds[2]);
  assert.notEqual(replay.current.resultIds[0], replay.current.resultIds[1]);
});

const unsupportedQueries = [
  canonicalJson({ kind: "inspection-approved-binding-catalog", version: 2 }),
  canonicalJson({ kind: "reference-bindings", sceneId: "start", lineIds: [] }),
  "malformed-json",
];
for (const query of unsupportedQueries) {
  test(`inspection replay does not establish support for ${query}`, async () => {
    // Given
    const f = await inspectFixture();
    const recorded = { ...await expectedBindingCatalogRead(f.bindings), query };
    // When
    const replay = await replayInspectionQuery(f.input.candidate, recorded);
    // Then
    assert.deepEqual(replay, { kind: "unsupported", reason: "UNSUPPORTED_INSPECTION_QUERY" });
  });
}

test("inspection replay rejects a catalog query with a mismatched scope", async () => {
  // Given
  const f = await inspectFixture();
  const recorded = { ...await expectedBindingCatalogRead(f.bindings), scope: [] };
  // When
  const replay = await replayInspectionQuery(f.input.candidate, recorded);
  // Then
  assert.deepEqual(replay, { kind: "unsupported", reason: "UNSUPPORTED_INSPECTION_QUERY" });
});
