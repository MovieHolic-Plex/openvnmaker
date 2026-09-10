import assert from "node:assert/strict";
import { canonicalHash } from "../src/canonical.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectHeadSchema, uuidSchema } from "../src/primitives.js";
import { reuseListEnvelopeSchema } from "../src/reuse-artifact-contracts.js";
import { captureReuseListPatch } from "../src/reuse-capture.js";
import { scriptSchema } from "../src/script-contracts.js";
import { reuseFixture } from "./reuse-fixture.js";

export async function resolutionUpdateFixture() {
  const fixture = await reuseFixture();
  const originalLine = fixture.capture.before.candidate.script.scenes.find(
    scene => scene.id === "start",
  )?.lines[0];
  assert.ok(originalLine);
  const proposedText = "Selected candidate field";
  const originalEntityHash = await canonicalHash(originalLine);
  const envelope = reuseListEnvelopeSchema.parse({
    ...fixture.capture.before.envelope, tool: "patch_lines",
    callId: "00000000-0000-4000-8000-000000000091",
    arguments: { sceneId: "start", operations: [{
      kind: "update", lineId: originalLine.id, expectedEntityHash: originalEntityHash,
      patch: { set: { text: proposedText, shake: true }, unset: ["when"] },
    }] },
  });
  const before = { ...fixture.capture.before, envelope };
  const after = await applyCandidateTool(before);
  assert.equal(after.result.ok, true);
  const operationId = uuidSchema.parse("00000000-0000-4000-8000-000000000092");
  const captured = await captureReuseListPatch({
    ...fixture.capture, before, after,
    artifactId: uuidSchema.parse("00000000-0000-4000-8000-000000000093"),
    operationIds: [operationId],
  });
  assert.equal(captured.kind, "ready");
  const currentLine = { ...originalLine, shake: false };
  const script = scriptSchema.parse({
    ...fixture.base.script,
    scenes: fixture.base.script.scenes.map(scene => scene.id === "start"
      ? { ...scene, lines: [currentLine] } : scene),
  });
  return {
    ...fixture, proposedText, currentLine, operationId, originalEntityHash,
    currentEntityHash: await canonicalHash(currentLine),
    base: { ...fixture.base, script },
    newBaseHead: projectHeadSchema.parse({
      ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
    }),
    selection: {
      artifact: captured.artifact, expectedArtifactHash: captured.artifact.artifactHash,
      receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000094"),
    },
  };
}
