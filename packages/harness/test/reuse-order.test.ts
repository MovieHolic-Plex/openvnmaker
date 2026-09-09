import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, canonicalJson } from "../src/canonical.js";
import { applyCandidateTool } from "../src/operations.js";
import { uuidSchema } from "../src/primitives.js";
import {
  reuseListEnvelopeSchema, reuseListPatchArtifactSchema,
  reuseListPatchPayloadSchema,
} from "../src/reuse-artifact-contracts.js";
import { assembleReuseListPatches } from "../src/reuse-assembly.js";
import { reuseFixture } from "./reuse-fixture.js";

test("checks a later patch against the preceding preserved output in order", async () => {
  // Given two successful calls, where the second edits the first call's new line.
  const fixture = await reuseFixture();
  const first = fixture.capture.after;
  const inserted = first.candidate.script.scenes.find(scene => scene.id === "start")?.lines[1];
  assert.ok(inserted);
  assert.ok(inserted.id);
  const envelope = reuseListEnvelopeSchema.parse({
    tool: "patch_lines", callId: "00000000-0000-4000-8000-000000000046",
    candidateId: first.candidate.ref.candidateId,
    expectedCandidateRevision: first.candidate.ref.revision,
    arguments: { sceneId: "start", operations: [{
      kind: "update", lineId: inserted.id, expectedEntityHash: await canonicalHash(inserted),
      patch: { set: { text: "Refined preserved output" }, unset: [] },
    }] },
  });
  const second = await applyCandidateTool({
    ...fixture.capture.before, candidate: first.candidate,
    journal: first.journal, envelope,
  });
  assert.equal(second.result.ok, true);
  const receipt = second.journal.calls.find(call => call.result.callId === envelope.callId);
  assert.ok(receipt);
  const payload = reuseListPatchPayloadSchema.parse({
    ...fixture.payload, artifactId: "00000000-0000-4000-8000-000000000047",
    operationIds: ["00000000-0000-4000-8000-000000000048"],
    inputRef: first.candidate.ref, outputRef: second.candidate.ref,
    inputSnapshotHash: fixture.payload.outputSnapshotHash,
    outputSnapshotHash: await canonicalHash({
      script: second.candidate.script, productionDocument: second.candidate.productionDocument,
    }),
    envelope, receipt, allocations: second.journal.allocations,
  });
  const artifact = reuseListPatchArtifactSchema.parse({
    artifactId: payload.artifactId,
    artifactHash: await canonicalHash(payload), payload: canonicalJson(payload),
  });
  const expected = second.candidate.script.scenes.find(scene => scene.id === "start");
  assert.ok(expected);
  // When the ordered artifacts are assembled over the fresh candidate.
  const result = await assembleReuseListPatches({
    base: fixture.base, newBaseHead: fixture.newBaseHead,
    patches: [fixture.selection, {
      artifact, expectedArtifactHash: artifact.artifactHash,
      receiptId: uuidSchema.parse("00000000-0000-4000-8000-000000000049"),
    }],
  });
  // Then the second precondition sees the first insertion, not the raw new source.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.candidate.script.scenes.find(scene => scene.id === "start"), expected);
  assert.deepEqual(result.receipts.map(row => row.reusedFrom.artifactHash), [
    fixture.artifact.artifactHash, artifact.artifactHash,
  ]);
});
