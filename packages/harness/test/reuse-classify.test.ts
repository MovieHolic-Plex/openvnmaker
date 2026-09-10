import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { replayContextDependencies } from "../src/context.js";
import { readSetSchema } from "../src/context-contracts.js";
import { projectHeadSchema } from "../src/primitives.js";
import { classifyReuseListUnit } from "../src/reuse-classify.js";
import { reuseListUnitEvidenceSchema } from "../src/reuse-unit-evidence.js";
import { scriptSchema } from "../src/script-contracts.js";
import { classifyFixture } from "./reuse-classify-fixture.js";

test("classifies matching real context and inspection reads at their own historical prefixes", async () => {
  // Given real pre/post-insertion frames and unrelated latest-source chapter text edits.
  const input = await classifyFixture();
  const before = canonicalJson({ unit: input.unit, evidence: input.evidence, current: input.currentBase });
  const post = input.evidence.frames[1];
  assert.ok(post);
  const wrongPrefix = await replayContextDependencies({
    sourceHead: input.newBaseHead, candidateRef: input.currentBase.ref,
    script: input.currentBase.script, productionDocument: input.currentBase.productionDocument,
  }, post.readSet);
  assert.equal(wrongPrefix.some(row => row.kind !== "unchanged"), true);
  // When direct classification reconstructs and checks each recorded prefix separately.
  const result = await classifyReuseListUnit(input);
  // Then eligibility requires both real replay owners and retains all ordered outcomes.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "eligible");
  assert.equal(result.output.kind, "verified");
  assert.equal(result.frames.length, 2);
  for (const [index, assessment] of result.frames.entries()) {
    const frame = input.evidence.frames[index];
    assert.ok(frame);
    assert.equal(assessment.kind, "replayed");
    assert.equal(assessment.frameId, frame.frameId);
    assert.equal(assessment.current.length, frame.readSet.length);
    assert.deepEqual(assessment.current.map(row => row.context.recorded), frame.readSet);
    assert.equal(assessment.current.every(row => row.comparison === "unchanged"), true);
  }
  const first = result.frames[0];
  assert.ok(first);
  assert.equal(first.kind, "replayed");
  const owned = first.current.filter(row => row.owner === "inspection");
  assert.equal(owned.length, 2);
  assert.equal(owned.every(row => row.context.kind === "unsupported" && row.inspection.kind === "current"), true);
  assert.equal(canonicalJson({ unit: input.unit, evidence: input.evidence, current: input.currentBase }), before);
});

test("inspection current reconstruction is compared fully rather than treated as unchanged", async () => {
  // Given a changed title observed by project_overview but not by the scene window.
  const input = await classifyFixture();
  const script = scriptSchema.parse({ ...input.currentBase.script, title: "Current project title" });
  // When the real inspection owner reconstructs the newer overview dependency.
  const result = await classifyReuseListUnit({
    ...input, currentBase: { ...input.currentBase, script },
    newBaseHead: projectHeadSchema.parse({ ...input.newBaseHead, scriptHash: await canonicalHash(script) }),
  });
  // Then a current value is not itself an unchanged-value proof.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "needs-review");
  assert.equal(result.frames.some(frame => frame.kind === "replayed" && frame.current.some(row =>
    row.owner === "inspection" && row.inspection.kind === "current" && row.comparison === "changed")), true);
});

test("unknown context recipes stay unsupported even when known inspection queries are reconstructed", async () => {
  // Given a preserved future recipe alongside both real operation-owned inspection queries.
  const extra = readSetSchema.parse([{
    kind: "query", query: canonicalJson({ kind: "scene-window", version: 99, sceneId: "start", limit: 1 }),
    scope: [{ kind: "scene", sceneId: "start" }], resultIds: [], hash: "d".repeat(64),
  }]);
  const input = await classifyFixture(extra);
  // When the classifier delegates only to actual registered owners.
  const result = await classifyReuseListUnit(input);
  // Then unrelated successful inspection reconstruction cannot erase unsupported context.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "needs-review");
  assert.equal(result.frames.some(frame => frame.kind === "replayed" && frame.current.some(row =>
    row.owner === "context" && row.context.kind === "unsupported" && row.comparison === "unsupported")), true);
});

test("a current scope-patch conflict outranks changed context without refreshing the original gap", async () => {
  // Given a new source line occupies the recorded terminal insertion gap.
  const input = await classifyFixture();
  const script = scriptSchema.parse({
    ...input.currentBase.script,
    scenes: input.currentBase.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: [...scene.lines, { id: "manual-line", speaker: null, text: "Source insertion" }],
    } : scene),
  });
  // When applicability and per-frame reads are both checked on the current snapshot.
  const result = await classifyReuseListUnit({
    ...input, currentBase: { ...input.currentBase, script },
    newBaseHead: projectHeadSchema.parse({ ...input.newBaseHead, scriptHash: await canonicalHash(script) }),
  });
  // Then a missing current prefix is not fabricated or silently retargeted for replay.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "conflict");
  assert.equal(result.frames.some(frame => frame.kind === "prefix-conflict" && frame.reason === "STALE_GAP"), true);
});

test("missing output remains unavailable despite intact frame and patch evidence", async () => {
  // Given all source metadata is intact, but storage cannot supply successful output bytes.
  const input = await classifyFixture();
  // When direct classification invokes the real output verification gate.
  const result = await classifyReuseListUnit({ ...input, output: { kind: "missing" } });
  // Then metadata/replay cannot replace the missing artifact.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "unavailable");
  assert.equal(result.output.kind, "unavailable");
  assert.equal(result.output.reason, "OUTPUT_MISSING");
});

test("rejects a self-consistent evidence sidecar whose frame claims the wrong historical prefix", async () => {
  // Given a sidecar with valid own hashing but a post-insertion frame claiming the empty prefix.
  const input = await classifyFixture();
  const evidence = reuseListUnitEvidenceSchema.parse({
    ...input.evidence, frames: input.evidence.frames.map((frame, index) => index === 1
      ? { ...frame, precedingPatchArtifactHashes: [] } : frame),
  });
  // When historical ref/content binding is checked, not merely the sidecar's self-hash.
  const result = await classifyReuseListUnit({ ...input, evidence, expectedEvidenceHash: await canonicalHash(evidence) });
  // Then the recorded preimage cannot be reassigned to a different temporal position.
  assert.deepEqual(result, { kind: "blocked", reason: "EVIDENCE_MISMATCH" });
});

test("rejects frame changes against the externally retained evidence hash", async () => {
  // Given otherwise plausible frame edits that were never in the immutable source evidence.
  const input = await classifyFixture();
  const evidence = reuseListUnitEvidenceSchema.parse({
    ...input.evidence, frames: input.evidence.frames.map((frame, index) => index === 0
      ? { ...frame, readSet: [] } : frame),
  });
  // When the original expected evidence hash is retained by the source owner.
  const result = await classifyReuseListUnit({ ...input, evidence });
  // Then self-supplied read scope cannot grant eligibility.
  assert.deepEqual(result, { kind: "blocked", reason: "EVIDENCE_MISMATCH" });
});
