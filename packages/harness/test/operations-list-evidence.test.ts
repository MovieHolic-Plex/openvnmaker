import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateRefSchema, canonicalHash, parseProjectHead, parseToolEnvelope,
  readSetSchema, scriptSchema, toolArgumentsSchemas, writeSetSchema,
} from "../src/index.js";
import { readSceneContext, replayContextDependencies } from "../src/context.js";
import type { ContextSource } from "../src/context.js";
import { applyCandidateTool } from "../src/operations.js";
import { head } from "./fixtures.js";
import { projectFixture } from "./operations-project-fixture.js";

async function evidenceFixture() {
  const f = await projectFixture();
  const firstScene = f.input.candidate.script.scenes[0];
  const ending = f.input.candidate.script.scenes[1];
  const first = firstScene?.lines[0];
  assert.ok(firstScene);
  assert.ok(ending);
  assert.ok(first);
  const neighbor = { id: "l-b", speaker: null, text: "Unreturned neighbor" };
  const script = scriptSchema.parse({
    ...f.input.candidate.script,
    scenes: [
      { ...firstScene, lines: [first, neighbor] },
      { ...ending, lines: [{ id: "end-only", speaker: null, text: "End" }] },
    ],
  });
  const candidate = { ...f.input.candidate, script };
  const context: ContextSource = {
    sourceHead: parseProjectHead({
      ...head, scriptHash: await canonicalHash(script),
      productionHash: await canonicalHash(candidate.productionDocument),
    }),
    candidateRef: candidate.ref, script, productionDocument: candidate.productionDocument,
  };
  const input = {
    ...f.input, candidate,
    authorizedWriteSet: writeSetSchema.parse([{
      target: { kind: "scene", sceneId: "start" }, fields: ["lines", "framing"],
    }]),
  };
  const update = {
    kind: "update", lineId: "l-a", expectedEntityHash: await canonicalHash(first),
    patch: { set: { text: "Edited target" }, unset: [] },
  } as const;
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_lines",
    arguments: { sceneId: "start", operations: [update] },
  });
  const expectedReadSet = readSetSchema.parse([{
    kind: "entity", target: { kind: "line", sceneId: "start", lineId: "l-a" },
    hash: await canonicalHash(first),
  }]);
  return { ...f, input, context, first, neighbor, update, envelope, expectedReadSet };
}

function changeNeighbor(source: ContextSource): ContextSource {
  return {
    ...source,
    candidateRef: candidateRefSchema.parse({ ...source.candidateRef, revision: 5 }),
    script: scriptSchema.parse({
      ...source.script,
      scenes: source.script.scenes.map(scene => scene.id === "start" ? {
        ...scene,
        lines: scene.lines.map(line =>
          line.id === "l-b" ? { ...line, text: "Independent neighbor edit" } : line),
      } : scene),
    }),
  };
}

test("records a full scoped line precondition rather than the whole scene for a text-only update", async () => {
  // Given
  const f = await evidenceFixture();

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.deepEqual(outcome.result.readSet, f.expectedReadSet);
  assert.deepEqual(outcome.journal.calls[0]?.result, outcome.result);
});

test("keeps both reader and operation dependencies unchanged after an excluded same-scene text edit", async () => {
  // Given
  const f = await evidenceFixture();
  const read = await readSceneContext(f.context, toolArgumentsSchemas.read_scene.parse({
    sceneId: "start", limit: 1,
  }));
  assert.equal(read.kind, "ready");
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(outcome.result.ok, true);
  const recorded = [...read.readSet, ...outcome.result.readSet];
  const comparison = changeNeighbor(f.context);

  // When
  const replay = await replayContextDependencies(comparison, recorded);

  // Then
  assert.deepEqual(replay.map(item => item.kind), recorded.map(() => "unchanged"));
});

test("retains full-entity sensitivity when an unpatched property of the target changes", async () => {
  // Given
  const f = await evidenceFixture();
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(outcome.result.ok, true);
  const comparison: ContextSource = {
    ...f.context,
    script: scriptSchema.parse({
      ...f.context.script,
      scenes: f.context.script.scenes.map(scene => scene.id === "start" ? {
        ...scene, lines: scene.lines.map(line =>
          line.id === "l-a" ? { ...line, shake: true } : line),
      } : scene),
    }),
  };

  // When
  const replay = await replayContextDependencies(comparison, outcome.result.readSet);

  // Then
  assert.ok(replay.some(item => item.kind === "changed"));
});

test("reports a missing scoped target when the same line moves to another scene", async () => {
  // Given
  const f = await evidenceFixture();
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(outcome.result.ok, true);
  const comparison: ContextSource = {
    ...f.context,
    script: scriptSchema.parse({
      ...f.context.script,
      scenes: f.context.script.scenes.map(scene => scene.id === "start"
        ? { ...scene, lines: scene.lines.filter(line => line.id !== "l-a") }
        : { ...scene, lines: [...scene.lines, f.first] }),
    }),
  };

  // When
  const replay = await replayContextDependencies(comparison, outcome.result.readSet);

  // Then
  assert.deepEqual(replay.map(item => item.kind), ["missing"]);
});

test("records only the initial external preimage while retaining ordered intra-batch hashes", async () => {
  // Given
  const f = await evidenceFixture();
  const intermediate = { ...f.first, text: "Intermediate text" };
  const envelope = parseToolEnvelope({
    ...f.envelope,
    arguments: { sceneId: "start", operations: [
      { ...f.update, patch: { set: { text: intermediate.text }, unset: [] } },
      {
        ...f.update, expectedEntityHash: await canonicalHash(intermediate),
        patch: { set: { text: "Final text" }, unset: [] },
      },
    ] },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.candidate.script.scenes[0]?.lines[0]?.text, "Final text");
  assert.deepEqual(outcome.result.readSet, f.expectedReadSet);
});

test("preserves legacy full-scene dependency semantics after an excluded line changes", async () => {
  // Given
  const f = await evidenceFixture();
  const scene = f.context.script.scenes[0];
  assert.ok(scene);
  const recorded = readSetSchema.parse([{
    kind: "entity", target: { kind: "scene", sceneId: "start" },
    hash: await canonicalHash(scene),
  }]);

  // When
  const replay = await replayContextDependencies(changeNeighbor(f.context), recorded);

  // Then
  assert.deepEqual(replay.map(item => item.kind), ["changed"]);
});

test("keeps set_scene whole-scene optimistic protection after an unrelated line changes", async () => {
  // Given
  const f = await evidenceFixture();
  const scene = f.context.script.scenes[0];
  assert.ok(scene);
  const comparison = changeNeighbor(f.context);
  const candidate = {
    ...f.input.candidate, ref: comparison.candidateRef, script: comparison.script,
  };
  const envelope = parseToolEnvelope({
    ...f.common, expectedCandidateRevision: candidate.ref.revision, tool: "set_scene",
    arguments: {
      sceneId: "start", expectedSceneHash: await canonicalHash(scene),
      patch: { set: { framing: "close" }, unset: [] },
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "STALE_TARGET");
  assert.deepEqual(outcome.candidate, candidate);
});
