import assert from "node:assert/strict";
import { canonicalHash } from "../src/canonical.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectHeadSchema, uuidSchema } from "../src/primitives.js";
import { reuseListEnvelopeSchema } from "../src/reuse-artifact-contracts.js";
import { captureReuseListPatch } from "../src/reuse-capture.js";
import { resolutionSchema } from "../src/reuse-contracts.js";
import { scriptSchema } from "../src/script-contracts.js";
import { reuseFixture } from "./reuse-fixture.js";

export async function choiceResolutionFixture() {
  const fixture = await reuseFixture();
  const originalChoice = fixture.capture.before.candidate.script.scenes.find(
    scene => scene.id === "start",
  )?.choices?.[0];
  assert.ok(originalChoice);
  const insertEnvelope = reuseListEnvelopeSchema.parse({
    ...fixture.capture.before.envelope, tool: "patch_choices",
    callId: "00000000-0000-4000-8000-000000000201",
    arguments: { sceneId: "start", operations: [{
      kind: "insert", gap: { leftId: "c-a", rightId: null },
      choices: [
        { clientKey: "route-a", value: { text: "First preserved route", next: "end", disable: false } },
        { clientKey: "route-b", value: { text: "Second preserved route", next: "end" } },
      ],
    }] },
  });
  const beforeInsert = { ...fixture.capture.before, envelope: insertEnvelope };
  const afterInsert = await applyCandidateTool(beforeInsert);
  assert.equal(afterInsert.result.ok, true);
  const insert = await captureReuseListPatch({
    ...fixture.capture, before: beforeInsert, after: afterInsert,
    artifactId: uuidSchema.parse("00000000-0000-4000-8000-000000000203"),
    operationIds: [uuidSchema.parse("00000000-0000-4000-8000-000000000202")],
  });
  assert.equal(insert.kind, "ready");
  const proposedText = "Selected route text";
  const proposedSet = { coins: 2 };
  const updateOperationId = uuidSchema.parse("00000000-0000-4000-8000-000000000205");
  const updateEnvelope = reuseListEnvelopeSchema.parse({
    ...insertEnvelope, callId: "00000000-0000-4000-8000-000000000204",
    expectedCandidateRevision: afterInsert.candidate.ref.revision,
    arguments: { sceneId: "start", operations: [{
      kind: "update", choiceId: originalChoice.id,
      expectedEntityHash: await canonicalHash(originalChoice),
      patch: { set: { text: proposedText, set: proposedSet }, unset: ["add"] },
    }] },
  });
  const beforeUpdate = {
    ...beforeInsert, candidate: afterInsert.candidate,
    journal: afterInsert.journal, envelope: updateEnvelope,
  };
  const afterUpdate = await applyCandidateTool(beforeUpdate);
  assert.equal(afterUpdate.result.ok, true);
  const update = await captureReuseListPatch({
    ...fixture.capture, before: beforeUpdate, after: afterUpdate,
    artifactId: uuidSchema.parse("00000000-0000-4000-8000-000000000206"),
    operationIds: [updateOperationId],
  });
  assert.equal(update.kind, "ready");
  const insertedScene = afterInsert.candidate.script.scenes.find(scene => scene.id === "start");
  assert.ok(insertedScene?.choices);
  const insertedChoices = insertedScene.choices.slice(1);
  assert.equal(insertedChoices.length, 2);
  const lastId = insertedChoices.at(-1)?.id;
  assert.ok(lastId);
  const currentChoice = { ...originalChoice, disable: true };
  const script = scriptSchema.parse({
    ...fixture.base.script,
    scenes: fixture.base.script.scenes.map(scene => scene.id === "start" ? {
      ...insertedScene, choices: [currentChoice, ...insertedChoices],
    } : scene),
  });
  return {
    base: { ...fixture.base, script },
    newBaseHead: projectHeadSchema.parse({
      ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
    }),
    unitId: fixture.capture.before.unitId, proposedText, proposedSet,
    currentChoice, currentChoiceHash: await canonicalHash(currentChoice),
    insertedChoices, updateOperationId,
    insertSelection: {
      artifact: insert.artifact, expectedArtifactHash: insert.artifact.artifactHash,
      receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000207"),
    },
    updateSelection: {
      artifact: update.artifact, expectedArtifactHash: update.artifact.artifactHash,
      receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000208"),
    },
    copyResolution: resolutionSchema.parse({
      kind: "insert-as-new", sourceArtifactId: insert.artifact.artifactId,
      sceneId: "start", gap: { leftId: lastId, rightId: null }, clientKey: "route-copy",
    }),
  };
}
