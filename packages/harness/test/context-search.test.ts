import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical.js";
import { searchContext } from "../src/context.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

test("normalizes search matching without rewriting canon text or belief attribution", async () => {
  // Given composed source text and a decomposed uppercase query.
  const source = await selectionSource();
  const args = toolArgumentsSchemas.search_content.parse({
    query: "CAFE\u0301", kinds: ["canon"], sceneId: "start",
  });
  // When approved source canon is searched.
  const result = await searchContext(source, args);
  // Then the matching record preserves its original text and truth attribution.
  assert.equal(result.kind, "ready");
  assert.equal(result.hits.length, 1);
  const hit = result.hits[0];
  assert.ok(hit);
  assert.equal(hit.kind, "canon");
  assert.deepEqual(hit.entry, source.productionDocument.worldTimeline[0]);
});

test("records complete scoped query membership even when only one hit is returned", async () => {
  // Given two matches in the selected scene and another in its sibling.
  const source = await selectionSource();
  const args = toolArgumentsSchemas.search_content.parse({
    query: "caf\u00e9", kinds: ["line"], sceneId: "start", limit: 1,
  });
  // When the first result page is selected.
  const result = await searchContext(source, args);
  // Then dependencies cover all matching scoped IDs, not only the page.
  assert.equal(result.kind, "ready");
  assert.equal(result.hits.length, 1);
  assert.equal(typeof result.nextCursor, "string");
  const query = result.readSet.find(dependency => dependency.kind === "query");
  assert.deepEqual(query?.resultIds, [
    canonicalJson({ kind: "line", sceneId: "start", lineId: "l1" }),
    canonicalJson({ kind: "line", sceneId: "start", lineId: "l2" }),
  ]);
});
