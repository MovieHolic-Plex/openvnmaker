import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { projectHeadSchema } from "../src/primitives.js";
import {
  assembleReuseSceneMetadataPatches, captureReuseSceneMetadataPatch, classifyReuseSceneMetadataUnit,
} from "../src/reuse-scene.js";
import { scriptSchema } from "../src/script-contracts.js";
import { sceneMetadataReuseFixture } from "./reuse-scene-fixture.js";

test("captures a real no-exit background metadata patch with its original whole-scene precondition", async () => {
  // Given an actual primary operation success and an independently built immutable artifact.
  const fixture = await sceneMetadataReuseFixture();
  assert.deepEqual(fixture.payload.receipt.result.readSet, [{
    kind: "entity", target: { kind: "scene", sceneId: "start" }, hash: fixture.expectedSceneHash,
  }]);
  // When scene metadata evidence is captured without widening it into a whole-candidate replacement.
  const result = await captureReuseSceneMetadataPatch(fixture.capture);
  // Then original scope, precondition and immutable bytes are retained.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.artifact, fixture.artifact);
});

test("classifies an unchanged first-chapter background scope patch eligible after another chapter edit", async () => {
  // Given complete source/frame/model evidence and only an unrelated chapter changed.
  const fixture = await sceneMetadataReuseFixture();
  const original = canonicalJson(fixture.input.unit);
  // When the real-owner direct classifier handles a non-list scene-metadata artifact.
  const result = await classifyReuseSceneMetadataUnit(fixture.input);
  // Then the supported background scope is reusable, without claiming image or source approval.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "eligible");
  assert.equal(result.output.kind, "verified");
  assert.equal(canonicalJson(fixture.input.unit), original);
});

test("assembles only saved background metadata while preserving source text, routes and the other chapter edit", async t => {
  // Given a saved background attachment/direction patch and a newer source snapshot.
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external request"); });
  const fixture = await sceneMetadataReuseFixture();
  const input = fixture.input;
  const original = canonicalJson(input.currentBase);
  // When a fresh candidate is assembled using original scene ID/hash/fields and a fresh assembly receipt.
  const result = await assembleReuseSceneMetadataPatches({
    base: input.currentBase, newBaseHead: input.newBaseHead, patches: input.patches,
  });
  // Then no old whole-candidate overwrite, model fetch or source mutation is involved.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start"), {
    ...fixture.target, ...fixture.patch.set,
  });
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "end"),
    input.currentBase.script.scenes.find(scene => scene.id === "end"));
  assert.equal(result.receipts[0]?.reusedFrom.artifactHash, fixture.artifact.artifactHash);
  assert.equal(canonicalJson(input.currentBase), original);
  assert.equal(provider.mock.callCount(), 0);
});

test("a target-scene line edit remains a conflict for a preserved background metadata patch", async () => {
  // Given a non-metadata field changed inside the exact target scene.
  const fixture = await sceneMetadataReuseFixture();
  const input = fixture.input;
  const script = scriptSchema.parse({ ...input.currentBase.script,
    scenes: input.currentBase.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: scene.lines.map(line => ({ ...line, text: "Changed target-scene line" })),
    } : scene),
  });
  const base = { ...input.currentBase, script };
  const newBaseHead = projectHeadSchema.parse({ ...input.newBaseHead, scriptHash: await canonicalHash(script) });
  // When metadata-only reuse still carries its original whole-scene optimistic precondition.
  const result = await assembleReuseSceneMetadataPatches({ base, newBaseHead, patches: input.patches });
  // Then the expected scene hash is not refreshed merely because written fields are narrower.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
});
