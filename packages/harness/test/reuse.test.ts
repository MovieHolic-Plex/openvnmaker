import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { captureReuseListPatch } from "../src/reuse-capture.js";
import { assembleReuseListPatches } from "../src/reuse-assembly.js";
import { reuseFixture } from "./reuse-fixture.js";

test("captures immutable evidence from a real successful candidate transition", async () => {
  // Given a journaled insertion and an independent expected payload.
  const fixture = await reuseFixture();
  const original = canonicalJson(fixture.capture);
  // When the success is captured for later reuse.
  const result = await captureReuseListPatch(fixture.capture);
  // Then all original evidence is bound without mutating the successful transition.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.artifact, fixture.artifact);
  assert.equal(result.artifact.payload, canonicalJson(fixture.payload));
  assert.equal(result.artifact.artifactHash, await canonicalHash(fixture.payload));
  assert.equal(canonicalJson(fixture.capture), original);
});

test("assembles preserved insertion IDs over a latest-source edit without replaying calls", async () => {
  // Given fixed successful insertion evidence and a fresh candidate over a later head.
  const fixture = await reuseFixture();
  const original = canonicalJson(fixture.base);
  const successfulScene = fixture.capture.after.candidate.script.scenes.find(
    scene => scene.id === "start",
  );
  const latestScene = fixture.base.script.scenes.find(scene => scene.id === "end");
  assert.ok(successfulScene);
  assert.ok(latestScene);
  // When the scope patch is assembled, without the old call journal.
  const result = await assembleReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead, patches: [fixture.selection],
  });
  // Then old output IDs and unrelated new source bytes coexist in a private candidate.
  assert.equal(result.kind, "ready");
  assert.equal(result.candidate.ref.candidateId, fixture.base.ref.candidateId);
  assert.equal(result.candidate.ref.revision, 1);
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start"), successfulScene);
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "end"), latestScene);
  assert.deepEqual(result.receipts, [{
    receiptId: fixture.selection.receiptId, candidateRef: result.candidate.ref,
    newBaseHead: fixture.newBaseHead,
    reusedFrom: {
      runId: fixture.capture.runId, unitId: fixture.capture.before.unitId,
      artifactHash: fixture.artifact.artifactHash, originHead: fixture.capture.originHead,
    },
  }]);
  assert.equal(canonicalJson(fixture.base), original);
});
