import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  canonicalHash, canonicalJson, contextWindowSchema, hashSchema,
  lineIdSchema, lineSchema, parseProjectHead, parseToolEnvelope, scriptSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { head } from "./fixtures.js";
import { projectFixture } from "./operations-project-fixture.js";

async function readFixture() {
  const f = await projectFixture();
  const first = { id: "l-a", speaker: null, text: "First CAFÉ" };
  const second = { id: "l-b", speaker: null, text: "Second match" };
  const third = { id: "l-c", speaker: null, text: "Third match" };
  const script = scriptSchema.parse({
    ...f.input.candidate.script,
    scenes: f.input.candidate.script.scenes.map(scene =>
      scene.id === "start" ? { ...scene, lines: [first, second, third] } : {
        ...scene, lines: [{ id: "other-only", speaker: null, text: "Other scope" }],
      }),
  });
  const candidate = { ...f.input.candidate, script };
  const sourceHead = parseProjectHead({
    ...head,
    scriptHash: await canonicalHash(script),
    productionHash: await canonicalHash(candidate.productionDocument),
  });
  return {
    ...f, first, second, third,
    input: { ...f.input, candidate, sourceHead },
  };
}

const sceneDataSchema = z.object({
  kind: z.literal("ready"),
  metadata: z.object({ id: z.string() }),
  lines: z.array(lineSchema),
  window: contextWindowSchema,
  beforeLineId: lineIdSchema.nullable(),
  afterLineId: lineIdSchema.nullable(),
});
const searchDataSchema = z.object({
  kind: z.literal("ready"),
  hits: z.array(z.object({
    kind: z.literal("line"), sceneId: z.string(), lineId: lineIdSchema,
    text: z.string(), hash: hashSchema,
  })),
  nextCursor: z.string().nullable(),
});

test("dispatches a bounded scene read without changing candidate content or revision", async () => {
  // Given
  const f = await readFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "read_scene",
    arguments: { sceneId: "start", afterLineId: "l-a", limit: 1 },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  const data = sceneDataSchema.parse(outcome.result.data);
  assert.equal(data.metadata.id, "start");
  assert.deepEqual(data.lines, [f.second]);
  assert.equal(data.beforeLineId, "l-a");
  assert.equal(data.afterLineId, "l-c");
  assert.deepEqual(data.window.lineIds, ["l-b"]);
  assert.equal(data.window.hash, await canonicalHash([f.second]));
  const entity = outcome.result.readSet.find(read =>
    read.kind === "entity" && read.target.kind === "line" &&
    read.target.sceneId === "start" && read.target.lineId === "l-b");
  assert.equal(entity?.hash, await canonicalHash(f.second));
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});

test("dispatches normalized search while preserving authored text and scoped identity", async () => {
  // Given
  const f = await readFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "search_content",
    arguments: { query: "cafe\u0301", kinds: ["line"], sceneId: "start", limit: 1 },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  const data = searchDataSchema.parse(outcome.result.data);
  assert.deepEqual(data.hits, [{
    kind: "line", sceneId: "start", lineId: "l-a",
    text: f.first.text, hash: await canonicalHash(f.first),
  }]);
  assert.equal(data.nextCursor, null);
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});

test("forwards complete query dependencies when search returns only its first page", async () => {
  // Given
  const f = await readFixture();
  const envelope = parseToolEnvelope({
    ...f.common, tool: "search_content",
    arguments: { query: "match", kinds: ["line"], sceneId: "start", limit: 1 },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  const data = searchDataSchema.parse(outcome.result.data);
  assert.deepEqual(data.hits.map(hit => hit.lineId), ["l-b"]);
  assert.equal(typeof data.nextCursor, "string");
  const query = outcome.result.readSet.find(read => read.kind === "query");
  assert.ok(query);
  assert.deepEqual(query.resultIds, ["l-b", "l-c"].map(lineId =>
    canonicalJson({ kind: "line", sceneId: "start", lineId })));
  assert.deepEqual(outcome.result.writeSet, []);
});

const failures = [
  {
    name: "read anchor belongs to another scene", tool: "read_scene",
    arguments: { sceneId: "start", afterLineId: "other-only", limit: 1 },
    revision: 4, code: "STALE_TARGET",
  },
  {
    name: "search cursor is malformed", tool: "search_content",
    arguments: { query: "match", kinds: ["line"], cursor: "malformed", limit: 1 },
    revision: 4, code: "INVALID_INPUT",
  },
  {
    name: "candidate revision is stale", tool: "read_scene",
    arguments: { sceneId: "start", limit: 1 },
    revision: 3, code: "STALE_HEAD",
  },
] as const;

for (const scenario of failures) {
  test(`rejects read dispatch when ${scenario.name}`, async () => {
    // Given
    const f = await readFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, expectedCandidateRevision: scenario.revision,
      tool: scenario.tool, arguments: scenario.arguments,
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, scenario.code);
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
  });
}

test("rejects read dispatch when immutable run-origin context is missing", async () => {
  // Given
  const f = await projectFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "read_scene", arguments: { sceneId: "start", limit: 1 },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "INVALID_STATE");
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(f.input.candidate, before);
});
