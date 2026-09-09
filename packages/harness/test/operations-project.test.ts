import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, parseToolEnvelope, scriptSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectFixture } from "./operations-project-fixture.js";

test("patches project metadata when its hash and field scope match", async () => {
  // Given
  const f = await projectFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_project",
    arguments: {
      expectedMetadataHash: f.metadataHash,
      patch: { set: { title: "Revised title" }, unset: ["artDirection"] },
    },
  });
  const { artDirection: removed, ...preserved } = before.script;
  assert.equal(removed, f.metadata.artDirection);

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  assert.deepEqual(outcome.candidate.script, { ...preserved, title: "Revised title" });
  assert.deepEqual(outcome.candidate.productionDocument, before.productionDocument);
  assert.deepEqual(f.input.candidate, before);
});

test("keeps the revision when a project patch has no material change", async () => {
  // Given
  const f = await projectFixture();
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_project",
    arguments: {
      expectedMetadataHash: f.metadataHash,
      patch: { set: { title: f.metadata.title }, unset: [] },
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

const failures = [
  { name: "metadata is stale", authorized: true, stale: true, code: "STALE_TARGET" },
  { name: "fields are unauthorized", authorized: false, stale: false, code: "WRITE_SCOPE_DENIED" },
] as const;

for (const field of ["artDirection", "musicFadeSeconds", "credits"] as const) {
  test(`preserves optional metadata omission when ${field} is absent`, async () => {
    // Given
    const f = await projectFixture();
    const metadata = { ...f.metadata };
    const script = { ...f.input.candidate.script };
    Reflect.deleteProperty(metadata, field);
    Reflect.deleteProperty(script, field);
    const candidate = { ...f.input.candidate, script: scriptSchema.parse(script) };
    const before = structuredClone(candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "patch_project",
      arguments: {
        expectedMetadataHash: await canonicalHash(metadata),
        patch: { set: { title: "Revised title" }, unset: [] },
      },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });

    // Then
    assert.equal(outcome.result.ok, true);
    assert.deepEqual(outcome.candidate.script, { ...before.script, title: "Revised title" });
    assert.deepEqual(candidate, before);
  });
}

for (const scenario of failures) {
  test(`rejects project mutation when ${scenario.name}`, async () => {
    // Given
    const f = await projectFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "patch_project",
      arguments: {
        expectedMetadataHash: scenario.stale ? "b".repeat(64) : f.metadataHash,
        patch: { set: { title: "Rejected title" }, unset: [] },
      },
    });

    // When
    const outcome = await applyCandidateTool({
      ...f.input, envelope,
      authorizedWriteSet: scenario.authorized ? f.input.authorizedWriteSet : [],
    });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, scenario.code);
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
  });
}
