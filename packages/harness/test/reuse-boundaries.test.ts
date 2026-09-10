import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectHeadSchema, uuidSchema } from "../src/primitives.js";
import { reuseListEnvelopeSchema } from "../src/reuse-artifact-contracts.js";
import { assembleReuseListPatches } from "../src/reuse-assembly.js";
import { captureReuseListPatch } from "../src/reuse-capture.js";
import { scriptSchema } from "../src/script-contracts.js";
import { reuseFixture } from "./reuse-fixture.js";

async function updateEvidence(fixture: Awaited<ReturnType<typeof reuseFixture>>) {
  const first = fixture.capture.after;
  const target = first.candidate.script.scenes.find(scene => scene.id === "start")?.lines[0];
  assert.ok(target);
  const envelope = reuseListEnvelopeSchema.parse({
    tool: "patch_lines", callId: "00000000-0000-4000-8000-000000000081",
    candidateId: first.candidate.ref.candidateId,
    expectedCandidateRevision: first.candidate.ref.revision,
    arguments: { sceneId: "start", operations: [{
      kind: "update", lineId: target.id, expectedEntityHash: await canonicalHash(target),
      patch: { set: { text: "Preserved update" }, unset: [] },
    }] },
  });
  const before = {
    ...fixture.capture.before, candidate: first.candidate, journal: first.journal, envelope,
  };
  const after = await applyCandidateTool(before);
  assert.equal(after.result.ok, true);
  const captured = await captureReuseListPatch({
    ...fixture.capture, before, after,
    artifactId: uuidSchema.parse("00000000-0000-4000-8000-000000000082"),
    operationIds: [uuidSchema.parse("00000000-0000-4000-8000-000000000083")],
  });
  assert.equal(captured.kind, "ready");
  return {
    artifact: captured.artifact, expectedArtifactHash: captured.artifact.artifactHash,
    receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000084"),
  };
}

test("rejects capture when candidate output disagrees with the successful transition", async () => {
  // Given an unchanged success receipt paired with modified candidate content.
  const fixture = await reuseFixture();
  const after = fixture.capture.after;
  // When that inconsistent evidence is captured.
  const result = await captureReuseListPatch({
    ...fixture.capture,
    after: { ...after, candidate: {
      ...after.candidate, script: { ...after.candidate.script, title: "Unrecorded mutation" },
    } },
  });
  // Then no reusable artifact is issued.
  assert.deepEqual(result, { kind: "blocked", reason: "EVIDENCE_MISMATCH" });
});

test("rejects noncanonical artifact bytes even when they decode to the same object", async () => {
  // Given a retained hash and a payload with extra bytes.
  const fixture = await reuseFixture();
  const artifact = { ...fixture.artifact, payload: `${fixture.artifact.payload} ` };
  // When mechanical assembly reads that artifact.
  const result = await assembleReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [{ ...fixture.selection, artifact }],
  });
  // Then the retained content binding rejects it.
  assert.deepEqual(result, { kind: "blocked", reason: "ARTIFACT_MISMATCH" });
});

for (const identicalBytes of [true, false]) {
  test(`rejects an occupied insertion ID with identicalBytes=${identicalBytes}`, async () => {
    // Given the preserved scoped ID already exists in the latest source.
    const fixture = await reuseFixture();
    const successfulScene = fixture.capture.after.candidate.script.scenes.find(scene => scene.id === "start");
    assert.ok(successfulScene);
    const script = scriptSchema.parse({
      ...fixture.base.script,
      scenes: fixture.base.script.scenes.map(scene => scene.id === "start" ? {
        ...successfulScene, lines: successfulScene.lines.map((line, index) =>
          index === 1 && !identicalBytes ? { ...line, text: "Conflicting bytes" } : line),
      } : scene),
    });
    const base = { ...fixture.base, script };
    const original = canonicalJson(base);
    const newBaseHead = projectHeadSchema.parse({
      ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
    });
    // When the same supposedly new insertion is assembled.
    const result = await assembleReuseListPatches({ base, newBaseHead, patches: [fixture.selection] });
    // Then even identical bytes cannot authorize implicit overwrite or deduplication.
    assert.deepEqual(result, { kind: "blocked", reason: "ID_PAYLOAD_CONFLICT" });
    assert.equal(canonicalJson(base), original);
  });
}

test("rejects a newly occupied adjacent gap without selecting another position", async () => {
  // Given the saved terminal gap now has a new neighbor.
  const fixture = await reuseFixture();
  const script = scriptSchema.parse({
    ...fixture.base.script,
    scenes: fixture.base.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: [...scene.lines, { id: "new-neighbor", speaker: null, text: "Latest" }],
    } : scene),
  });
  const newBaseHead = projectHeadSchema.parse({
    ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
  });
  // When the preserved patch still names its original exact gap.
  const result = await assembleReuseListPatches({
    base: { ...fixture.base, script }, newBaseHead, patches: [fixture.selection],
  });
  // Then the insertion cannot silently move to the new end of the list.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_GAP" });
});

for (const moved of [false, true]) {
  test(`retains the original scoped entity precondition with moved=${moved}`, async () => {
    // Given a captured update whose original target is changed or no longer in its scene.
    const fixture = await reuseFixture();
    const selection = await updateEvidence(fixture);
    const script = scriptSchema.parse({
      ...fixture.base.script,
      scenes: fixture.base.script.scenes.map(scene => scene.id === "start" ? {
        ...scene, lines: scene.lines.map(line => moved
          ? { ...line, id: "replacement-line" } : { ...line, shake: true }),
      } : scene),
    });
    const newBaseHead = projectHeadSchema.parse({
      ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
    });
    // When the update is assembled; another scene still contains the same bare line ID.
    const result = await assembleReuseListPatches({
      base: { ...fixture.base, script }, newBaseHead, patches: [selection],
    });
    // Then neither a refreshed hash nor cross-scene retargeting can make it succeed.
    assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
  });
}

test("publishes no partial candidate or success receipts when a later patch conflicts", async () => {
  // Given the insertion can succeed but the subsequent update has a stale target.
  const fixture = await reuseFixture();
  const selection = await updateEvidence(fixture);
  const script = scriptSchema.parse({
    ...fixture.base.script,
    scenes: fixture.base.script.scenes.map(scene => scene.id === "start" ? {
      ...scene, lines: scene.lines.map(line => ({ ...line, text: "Concurrent source edit" })),
    } : scene),
  });
  const base = { ...fixture.base, script };
  const original = canonicalJson(base);
  const newBaseHead = projectHeadSchema.parse({
    ...fixture.newBaseHead, scriptHash: await canonicalHash(script),
  });
  // When the original successful artifacts are assembled in order.
  const result = await assembleReuseListPatches({
    base, newBaseHead, patches: [fixture.selection, selection],
  });
  // Then the rejected transaction exposes neither its earlier mutation nor receipts.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
  assert.equal(canonicalJson(base), original);
});
