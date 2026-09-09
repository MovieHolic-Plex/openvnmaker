import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../src/canonical.js";
import { buildContextManifest } from "../src/context.js";
import { readSetSchema } from "../src/context-contracts.js";
import { unitSchema } from "../src/lifecycle-contracts.js";
import { inspectionBindingCatalogDependency } from "../src/operations-inspect.js";
import { hashSchema } from "../src/primitives.js";
import { classifyReuseListUnit } from "../src/reuse-classify.js";
import { compareReuseFrameReads } from "../src/reuse-classify-reads.js";
import { reuseListUnitEvidenceSchema } from "../src/reuse-unit-evidence.js";
import { classifyFixture } from "./reuse-classify-fixture.js";

test("missing model-binding material cannot become complete from an opaque provenance hash", async () => {
  // Given source provenance retains the model hash but its descriptor material is absent.
  const input = await classifyFixture();
  const { modelBinding: _removed, ...source } = input.evidence;
  const evidence = reuseListUnitEvidenceSchema.parse(source);
  // When otherwise unchanged frames and valid bytes are classified.
  const result = await classifyReuseListUnit({ ...input, evidence, expectedEvidenceHash: await canonicalHash(evidence) });
  // Then unvalidated settings evidence is retained as a review requirement, not an approval flag.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "needs-review");
  assert.ok(result.direct.reasons.includes("UNVERIFIED_MODEL_BINDING"));
});

test("an input hash covering unknown extra settings is not replaced with the manifest-only hash", async () => {
  // Given immutable unit input identity differs from the supported structured manifest.
  const input = await classifyFixture();
  assert.equal(input.unit.status, "ready");
  const unit = unitSchema.parse({
    ...input.unit, provenance: { ...input.unit.provenance, inputContentHash: hashSchema.parse("f".repeat(64)) },
  });
  const evidence = reuseListUnitEvidenceSchema.parse({ ...input.evidence, unitHash: await canonicalHash(unit) });
  // When the recorded manifest is internally valid but cannot explain the complete unit input hash.
  const result = await classifyReuseListUnit({ ...input, unit, evidence, expectedEvidenceHash: await canonicalHash(evidence) });
  // Then the classifier does not silently assert that omitted model/settings input was unchanged.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "needs-review");
  assert.ok(result.direct.reasons.includes("UNVERIFIED_INPUT_CONTENT"));
});

test("operation receipt reads cannot be discarded by rewriting only unit and frame read coverage", async () => {
  // Given a internally rehashed sidecar/manifest omits the operation's recorded full-scene input.
  const input = await classifyFixture();
  assert.equal(input.unit.status, "ready");
  const frames = input.evidence.frames.map(frame => ({
    ...frame, readSet: frame.readSet.filter(read => !(read.kind === "entity" && read.target.kind === "scene")),
  }));
  const { inputContentHash: _removed, ...manifestInput } = input.unit.contextManifest;
  const manifest = await buildContextManifest({ ...manifestInput, readSet: frames.flatMap(frame => frame.readSet) });
  assert.equal(manifest.kind, "ready");
  const unit = unitSchema.parse({
    ...input.unit, contextManifest: manifest.manifest,
    provenance: { ...input.unit.provenance,
      inputContentHash: manifest.manifest.inputContentHash, readSet: manifest.manifest.readSet },
  });
  const evidence = reuseListUnitEvidenceSchema.parse({ ...input.evidence, unitHash: await canonicalHash(unit), frames });
  // When immutable operation artifacts still contain the dependency omitted from those other records.
  const result = await classifyReuseListUnit({ ...input, unit, evidence, expectedEvidenceHash: await canonicalHash(evidence) });
  // Then the classifier does not manufacture narrower eligibility by ignoring a genuine saved read.
  assert.equal(result.kind, "classified");
  assert.equal(result.direct.classification, "needs-review");
  assert.ok(result.direct.reasons.includes("INCOMPLETE_PATCH_READ_EVIDENCE"));
});

test("inspection reconstruction compares result IDs as well as the hash and retains Task8 unsupported evidence", async () => {
  // Given an operation-owned query with a matching hash but inconsistent recorded result membership.
  const input = await classifyFixture();
  const current = await inspectionBindingCatalogDependency(input.originalBase.productionDocument);
  const recorded = readSetSchema.parse([{ ...current, resultIds: ["unrecorded-binding"] }]);
  // When the actual replay owners reconstruct the same snapshot.
  const result = await compareReuseFrameReads({
    sourceHead: input.evidence.originalBase.sourceHead, candidateRef: input.originalBase.ref,
    script: input.originalBase.script, productionDocument: input.originalBase.productionDocument,
  }, recorded);
  // Then hash equality alone cannot turn a reconstructed current record into an unchanged one.
  const row = result[0];
  assert.ok(row);
  assert.equal(row.owner, "inspection");
  assert.equal(row.context.kind, "unsupported");
  assert.equal(row.inspection.kind, "current");
  assert.equal(row.inspection.current.hash, current.hash);
  assert.equal(row.comparison, "changed");
});
