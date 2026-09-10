import assert from "node:assert/strict";
import test from "node:test";
import { searchContext } from "../src/context.js";
import type { ContextSource } from "../src/context.js";
import {
  candidateRefSchema,
  projectHeadSchema,
} from "../src/primitives.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

const args = toolArgumentsSchemas.search_content.parse({
  query: "caf\u00e9", kinds: ["line"], sceneId: "start", limit: 1,
});

test("continues an opaque cursor without losing complete query dependencies", async () => {
  // Given the first page of a two-result query.
  const source = await selectionSource();
  const first = await searchContext(source, args);
  assert.equal(first.kind, "ready");
  assert.ok(first.nextCursor);
  // When the returned cursor is used unchanged.
  const result = await searchContext(source, { ...args, cursor: first.nextCursor });
  // Then the second hit is returned with the same complete dependency set.
  assert.equal(result.kind, "ready");
  assert.equal(result.hits.length, 1);
  const hit = result.hits[0];
  assert.ok(hit);
  assert.equal(hit.kind, "line");
  assert.equal(hit.lineId, "l2");
  assert.equal(result.nextCursor, null);
  assert.deepEqual(result.readSet, first.readSet);
});

test("rejects malformed cursor input without selecting a fallback page", async () => {
  // Given a non-cursor identifier accepted by the outer tool argument schema.
  const source = await selectionSource();
  const request = toolArgumentsSchemas.search_content.parse({
    ...args, cursor: "not-a-cursor",
  });
  // When the selector parses the cursor boundary.
  const result = await searchContext(source, request);
  // Then malformed input is rejected rather than interpreted as page zero.
  assert.deepEqual(result, { kind: "blocked", reason: "INVALID_INPUT" });
});

const changedSnapshots = [
  {
    name: "candidate revision",
    change: (source: ContextSource): ContextSource => ({
      ...source,
      candidateRef: candidateRefSchema.parse({
        ...source.candidateRef, revision: 5,
      }),
    }),
  },
  {
    name: "source authority",
    change: (source: ContextSource): ContextSource => ({
      ...source,
      sourceHead: projectHeadSchema.parse({
        ...source.sourceHead, revision: 5,
      }),
    }),
  },
] as const;

for (const fixture of changedSnapshots) {
  test(`rejects a cursor bound to an earlier ${fixture.name}`, async () => {
    // Given a valid cursor and independently changed snapshot authority.
    const source = await selectionSource();
    const first = await searchContext(source, args);
    assert.equal(first.kind, "ready");
    assert.ok(first.nextCursor);
    const changed = fixture.change(source);
    // When the old cursor is used against the changed snapshot.
    const result = await searchContext(changed, {
      ...args, cursor: first.nextCursor,
    });
    // Then cursor authority cannot silently transfer.
    assert.deepEqual(result, { kind: "blocked", reason: "STALE_HEAD" });
  });
}

test("rejects a cursor bound to different query criteria", async () => {
  // Given a valid cursor for a broader query.
  const source = await selectionSource();
  const first = await searchContext(source, args);
  assert.equal(first.kind, "ready");
  assert.ok(first.nextCursor);
  // When the cursor is supplied with a different query.
  const result = await searchContext(source, {
    ...args, query: "tower", cursor: first.nextCursor,
  });
  // Then the old result position cannot be reused in the new result set.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_HEAD" });
});
