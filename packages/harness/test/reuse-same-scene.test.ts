import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { projectHeadSchema } from "../src/primitives.js";
import { assembleReuseListPatches } from "../src/reuse-assembly.js";
import { classifyReuseListUnit } from "../src/reuse-classify.js";
import { scriptSchema } from "../src/script-contracts.js";
import { sameSceneReuseFixture } from "./reuse-same-scene-fixture.js";

test("same-scene bounded read and text-only batch preserve both edits through classification and assembly", async t => {
  // Given actual readers and two ordered text updates, with a newer unreturned line edit.
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external request"); });
  const fixture = await sameSceneReuseFixture("current");
  const { input } = fixture;
  const original = canonicalJson({ unit: input.unit, evidence: input.evidence, base: input.currentBase });
  assert.deepEqual(fixture.firstRead.window.lineIds, ["l-a"]);
  assert.ok(fixture.firstRead.excluded.some(row => row.target.kind === "line" && row.target.lineId === "l-b"));
  assert.deepEqual(fixture.payload.receipt.result.readSet, [{
    kind: "entity", target: { kind: "line", sceneId: "start", lineId: "l-a" }, hash: fixture.initialHash,
  }]);
  assert.deepEqual(fixture.payload.envelope.arguments.operations.map(operation => {
    assert.equal(operation.kind, "update");
    return operation.expectedEntityHash;
  }), [fixture.initialHash, fixture.intermediateHash]);
  // When the real classifier validates both prefixes and the actual assembler reuses the batch.
  const classification = await classifyReuseListUnit(input);
  assert.equal(classification.kind, "classified");
  assert.equal(classification.direct.classification, "eligible");
  const result = await assembleReuseListPatches({
    base: input.currentBase, newBaseHead: input.newBaseHead, patches: input.patches,
  });
  // Then generated and manual text coexist, with runtime fields and old provenance intact.
  assert.equal(result.kind, "ready");
  const lines = result.candidate.script.scenes.find(scene => scene.id === "start")?.lines;
  assert.deepEqual(lines, [
    { ...fixture.target, text: fixture.finalText },
    { id: "l-b", speaker: null, text: fixture.manualText, shake: true },
  ]);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0]?.reusedFrom.artifactHash, input.evidence.outputPatchArtifactHashes[0]);
  assert.equal(canonicalJson({ unit: input.unit, evidence: input.evidence, base: input.currentBase }), original);
  assert.equal(provider.mock.callCount(), 0);
});

test("an immutable legacy full-scene read still requires review for an unreturned same-scene edit", async () => {
  // Given the same narrow runtime operation retained under the older broad read contract.
  const fixture = await sameSceneReuseFixture("legacy");
  const original = canonicalJson(fixture.input.evidence);
  assert.ok(fixture.payload.receipt.result.readSet.some(row => row.kind === "entity" && row.target.kind === "scene"));
  // When the real replay owner evaluates the recorded legacy dependency, not a substituted projection.
  const result = await classifyReuseListUnit(fixture.input);
  // Then newer producer precision cannot retroactively discard a genuine saved dependency.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "needs-review");
  assert.ok(result.direct.changedDependencies.some(row => row.kind === "entity" && row.target.kind === "scene"));
  assert.equal(canonicalJson(fixture.input.evidence), original);
});

test("text-only reuse retains the full target precondition when a non-text target field changes", async () => {
  // Given the new producer reads only the selected line, but its precondition remains a whole-line hash.
  const fixture = await sameSceneReuseFixture("current");
  const input = fixture.input;
  const script = scriptSchema.parse({ ...input.currentBase.script, scenes: input.currentBase.script.scenes.map(scene =>
    scene.id === "start" ? { ...scene, lines: scene.lines.map(line => line.id === "l-a" ? { ...line, shake: true } : line) } : scene),
  });
  // When source metadata changes on the actual target rather than on an excluded line.
  const result = await classifyReuseListUnit({
    ...input, currentBase: { ...input.currentBase, script },
    newBaseHead: projectHeadSchema.parse({ ...input.newBaseHead, scriptHash: await canonicalHash(script) }),
  });
  // Then narrowing read scope does not refresh or weaken the original target hash.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "conflict");
  assert.ok(result.direct.reasons.includes("STALE_TARGET"));
});
