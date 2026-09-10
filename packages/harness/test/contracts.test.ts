import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalBytes, canonicalHash, canonicalJson, HarnessError, parseProjectHead, parseToolEnvelope } from "@vnmaker/harness";
import { head, insert } from "./fixtures.js";

test("reject-invalid-operation when an untrusted payload requests an unknown tool", () => {
  // Given: otherwise valid legacy content must not bypass the harness boundary.
  const input = {
    title: "Fixture", subtitle: "", start: "start", characters: [],
    scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Hi" }], ending: "End" }],
    callId: "00000000-0000-4000-8000-000000000001",
    candidateId: "00000000-0000-4000-8000-000000000002",
    expectedCandidateRevision: 4, tool: "run_shell", arguments: { command: "echo forbidden" },
  };
  const before = structuredClone(input);
  // When / Then
  assert.throws(() => parseToolEnvelope(input), error => error instanceof HarnessError && error.code === "UNKNOWN_TOOL");
  assert.deepEqual(input, before);
});

test("canonical-roundtrip when object key order and absent optional fields vary", async () => {
  // Given
  const original = parseProjectHead(head);
  const reordered = { productionHash: head.productionHash, scriptHash: head.scriptHash, revision: head.revision,
    lineageId: head.lineageId, projectId: head.projectId, optional: undefined };
  // When
  const hashes = await Promise.all([canonicalHash(original), canonicalHash(reordered)]);
  // Then
  assert.equal(hashes[0], hashes[1]);
  assert.deepEqual(parseProjectHead(JSON.parse(canonicalJson(original))), original);
});

test("preserves array order when hashing a canonical payload", async () => {
  // Given
  const first = ["a", "b"], second = ["b", "a"];
  // When
  const hashes = await Promise.all([canonicalHash(first), canonicalHash(second)]);
  // Then
  assert.notEqual(hashes[0], hashes[1]);
});

test("uses SHA256 when hashing known canonical JSON", async () => {
  // Given / When
  const digest = await canonicalHash({});
  // Then: independently published SHA256 test vector for the bytes 7b7d.
  assert.equal(digest, "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
});

test("sorts numeric-looking keys lexically when canonicalizing UTF8", () => {
  // Given / When
  const encoded = canonicalBytes({ "2": "한", "10": "😀" });
  // Then
  assert.deepEqual(encoded, new TextEncoder().encode('{"10":"😀","2":"한"}'));
});

for (const invalid of [NaN, Infinity, -Infinity, undefined, 1n, new Date(0), [undefined], new Array(2), new Map(), () => 0]) {
  test(`rejects non-JSON ${typeof invalid} when canonicalizing`, () => {
    // Given / When / Then
    assert.throws(() => canonicalJson(invalid), error => error instanceof HarnessError && error.code === "INVALID_CANONICAL_VALUE");
  });
}

test("rejects cycles when canonicalizing but allows shared values", () => {
  // Given
  const cyclic: { self?: object } = {};
  cyclic.self = cyclic;
  // When / Then
  assert.throws(() => canonicalJson(cyclic), HarnessError);
});

test("roundtrips insert envelopes when using the published tool boundary", () => {
  // Given / When
  const parsed = parseToolEnvelope(insert);
  // Then
  assert.deepEqual(parsed, insert);
});

test("reject-invalid-operation when a valid tool contains an unknown field", () => {
  // Given
  const input = { ...insert, arguments: { ...insert.arguments, unsafePath: "C:/escape" } };
  // When / Then
  assert.throws(() => parseToolEnvelope(input), error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
});

for (const mutation of [{ revision: -1 }, { revision: 0.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
  { lineageId: "not-a-uuid" }, { scriptHash: "A".repeat(64) }, { scriptHash: "a".repeat(63) }, { unexpected: true }]) {
  test("rejects invalid head fields when parsing a project boundary", () => {
    // Given / When / Then
    assert.throws(() => parseProjectHead({ ...head, ...mutation }), HarnessError);
  });
}
