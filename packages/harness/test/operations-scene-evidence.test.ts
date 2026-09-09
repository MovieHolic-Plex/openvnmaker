import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateRefSchema, canonicalHash, parseProductionDocument, parseProjectHead,
  parseToolEnvelope, readSetSchema, scriptSchema, writeSetSchema,
} from "../src/index.js";
import { replayContextDependencies } from "../src/context.js";
import type { ContextSource } from "../src/context.js";
import { applyCandidateTool } from "../src/operations.js";
import { head } from "./fixtures.js";
import { sceneFixture } from "./operations-scene-fixture.js";

async function backgroundFixture() {
  const f = await sceneFixture();
  const backgroundUrl = "/assets/registered-background.png";
  const candidate = {
    ...f.input.candidate,
    script: scriptSchema.parse({
      ...f.input.candidate.script,
      assets: [{
        id: "registered-background", name: "Registered background",
        kind: "background", url: backgroundUrl, sceneId: "start",
      }],
      scenes: f.input.candidate.script.scenes.map(scene => ({
        ...scene, chapter: scene.id === "start" ? "Chapter one" : "Chapter two",
      })),
    }),
  };
  const scene = candidate.script.scenes[0];
  assert.ok(scene);
  const source: ContextSource = {
    candidateRef: candidate.ref, script: candidate.script,
    productionDocument: candidate.productionDocument,
    sourceHead: parseProjectHead({
      ...head, scriptHash: await canonicalHash(candidate.script),
      productionHash: await canonicalHash(candidate.productionDocument),
    }),
  };
  const input = {
    ...f.input, candidate,
    authorizedWriteSet: writeSetSchema.parse([{
      target: { kind: "scene", sceneId: "start" },
      fields: ["backgroundUrl", "framing", "artBrief", "sprites", "exit"],
    }]),
  };
  const expectedSceneHash = await canonicalHash(scene);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "set_scene",
    arguments: {
      sceneId: "start", expectedSceneHash,
      patch: { set: { backgroundUrl }, unset: [] },
    },
  });
  return { ...f, input, source, scene, envelope, expectedSceneHash, backgroundUrl };
}

for (const field of ["background", "framing"] as const) {
  test(`records the genuine whole-scene precondition for no-exit ${field} metadata updates`, async () => {
    // Given
    const f = await backgroundFixture();
    const patches = {
      background: { set: { backgroundUrl: f.backgroundUrl }, unset: [] },
      framing: { set: { framing: "close" }, unset: ["artBrief"] },
    };
    const envelope = parseToolEnvelope({
      ...f.envelope,
      arguments: {
        sceneId: "start", expectedSceneHash: f.expectedSceneHash, patch: patches[field],
      },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, true);
    assert.deepEqual(outcome.result.readSet, readSetSchema.parse([{
      kind: "entity", target: { kind: "scene", sceneId: "start" },
      hash: f.expectedSceneHash,
    }]));
  });
}

test("keeps background-attachment evidence unchanged when only another chapter changes", async () => {
  // Given
  const f = await backgroundFixture();
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(outcome.result.ok, true);
  const comparison: ContextSource = {
    ...f.source,
    candidateRef: candidateRefSchema.parse({ ...f.source.candidateRef, revision: 5 }),
    script: scriptSchema.parse({
      ...f.source.script,
      scenes: f.source.script.scenes.map(scene => scene.id === "spare" ? {
        ...scene, chapter: "Revised other chapter",
        lines: scene.lines.map(line => ({ ...line, text: "Independent chapter revision" })),
      } : scene),
    }),
  };

  // When
  const replay = await replayContextDependencies(comparison, outcome.result.readSet);

  // Then
  assert.deepEqual(replay.map(item => item.kind), outcome.result.readSet.map(() => "unchanged"));
});

test("retains own-scene conflict protection when a line changes before background attachment", async () => {
  // Given
  const f = await backgroundFixture();
  const candidate = {
    ...f.input.candidate,
    ref: candidateRefSchema.parse({ ...f.input.candidate.ref, revision: 5 }),
    script: scriptSchema.parse({
      ...f.input.candidate.script,
      scenes: f.input.candidate.script.scenes.map(scene => scene.id === "start" ? {
        ...scene, lines: scene.lines.map(line => ({ ...line, text: "Concurrent own-scene edit" })),
      } : scene),
    }),
  };
  const envelope = parseToolEnvelope({
    ...f.envelope, expectedCandidateRevision: candidate.ref.revision,
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });

  // Then
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.code, "STALE_TARGET");
  assert.deepEqual(outcome.candidate, candidate);
});

test("does not acquire an outline dependency when no exit was requested", async () => {
  // Given
  const f = await backgroundFixture();
  const outcome = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(outcome.result.ok, true);
  const comparison: ContextSource = {
    ...f.source,
    productionDocument: parseProductionDocument({
      ...f.source.productionDocument,
      outline: {
        ...f.source.productionDocument.outline,
        scenes: f.source.productionDocument.outline.scenes.map(scene => ({
          ...scene, summary: "Independent outline revision",
        })),
      },
    }),
  };

  // When
  const replay = await replayContextDependencies(comparison, outcome.result.readSet);

  // Then
  assert.deepEqual(replay.map(item => item.kind), outcome.result.readSet.map(() => "unchanged"));
});

test("retains outline evidence when an explicit planned exit consumes it", async () => {
  // Given
  const f = await backgroundFixture();
  const envelope = parseToolEnvelope({
    ...f.envelope,
    arguments: {
      sceneId: "start", expectedSceneHash: f.expectedSceneHash,
      patch: { set: { backgroundUrl: f.backgroundUrl }, unset: [] },
      exit: { kind: "planned", sceneId: "future" },
    },
  });
  const outcome = await applyCandidateTool({ ...f.input, envelope });
  assert.equal(outcome.result.ok, true);
  const comparison: ContextSource = {
    ...f.source,
    productionDocument: parseProductionDocument({
      ...f.source.productionDocument,
      outline: { ...f.source.productionDocument.outline, scenes: [] },
    }),
  };

  // When
  const replay = await replayContextDependencies(comparison, outcome.result.readSet);

  // Then
  assert.ok(replay.some(item => item.kind === "changed" &&
    item.recorded.kind === "entity" && item.recorded.target.kind === "canon" &&
    item.recorded.target.sectionId === "outline"));
});

test("retains cast evidence when a no-exit sprite patch introduces a registered actor", async () => {
  // Given
  const f = await backgroundFixture();
  const candidate = {
    ...f.input.candidate,
    script: scriptSchema.parse({
      ...f.input.candidate.script,
      characters: [{ id: "actor", name: "Actor", color: "#112233", bio: "" }],
    }),
  };
  const envelope = parseToolEnvelope({
    ...f.envelope,
    arguments: {
      sceneId: "start", expectedSceneHash: f.expectedSceneHash,
      patch: { set: { sprites: [{ slot: "left", character: "actor" }] }, unset: [] },
    },
  });
  const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });
  assert.equal(outcome.result.ok, true);
  const comparison: ContextSource = {
    ...f.source,
    script: scriptSchema.parse({ ...candidate.script, characters: [] }),
  };

  // When
  const replay = await replayContextDependencies(comparison, outcome.result.readSet);

  // Then
  assert.ok(replay.some(item => item.kind === "changed" || item.kind === "missing"));
});
