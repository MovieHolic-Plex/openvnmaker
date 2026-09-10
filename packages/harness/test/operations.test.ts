import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateRefSchema,
  canonicalHash,
  parseProductionDocument,
  parseToolEnvelope,
  scriptSchema,
  unitIdSchema,
  writeSetSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { operationJournalSchema } from "../src/operations-receipts.js";
import { productionDocument } from "./fixtures.js";
import { scopedOperationFixtures } from "../../../tests/fixtures/harness/r2-operations.js";

test("stale-anchor-and-atomic-rejection", async () => {
  const unitId = unitIdSchema.parse("00000000-0000-4000-8000-000000000010");
  const fixture = await scopedOperationFixtures();
  assert.equal(fixture.update.tool, "patch_lines");
  assert.equal(fixture.insert.tool, "patch_lines");
  if (fixture.update.tool !== "patch_lines" ||
      fixture.insert.tool !== "patch_lines") {
    throw new Error("Unexpected operation fixture variant");
  }

  const script = scriptSchema.parse({
    title: "Atomic fixture",
    subtitle: "",
    nativeSaveId: "0123456789abcdef",
    credits: [{ role: "Writer", names: "Fixture" }],
    musicFadeSeconds: 0.5,
    start: fixture.staleGap.id,
    characters: [],
    scenes: [fixture.staleGap, fixture.otherScene],
  });
  const candidate = {
    ref: candidateRefSchema.parse({
      candidateId: fixture.update.candidateId,
      revision: 4,
    }),
    script,
    productionDocument: parseProductionDocument(productionDocument),
  };
  const before = structuredClone(candidate);
  const journal = operationJournalSchema.parse({
    candidateId: candidate.ref.candidateId, calls: [], allocations: [],
  });
  const sourceHash = await canonicalHash(script);
  const authorizedWriteSet = writeSetSchema.parse([{
    target: { kind: "scene", sceneId: fixture.staleGap.id },
    fields: ["lines"],
  }]);

  const control = await applyCandidateTool({
    journal,
    unitId,
    candidate,
    envelope: fixture.update,
    authorizedWriteSet,
  });
  assert.equal(control.result.ok, true);
  assert.equal(control.result.changed, true);
  assert.equal(control.candidate.ref.revision, 5);
  assert.equal(
    control.candidate.script.scenes[0]?.lines[0]?.text,
    "Synthetic repair",
  );
  assert.deepEqual(control.candidate.script.scenes[1], fixture.otherScene);
  assert.deepEqual(candidate, before);

  const envelope = parseToolEnvelope({
    ...fixture.update,
    callId: "00000000-0000-4000-8000-000000000099",
    arguments: {
      sceneId: fixture.staleGap.id,
      operations: [
        ...fixture.update.arguments.operations,
        ...fixture.insert.arguments.operations,
      ],
    },
  });
  const rejected = await applyCandidateTool({
    journal,
    unitId,
    candidate,
    envelope,
    authorizedWriteSet,
  });
  assert.equal(rejected.result.ok, false);
  if (rejected.result.ok) throw new Error("Stale batch was accepted");
  assert.equal(rejected.result.code, "STALE_GAP");
  assert.deepEqual(rejected.candidate, before);
  assert.deepEqual(candidate, before);
  assert.equal(await canonicalHash(script), sourceHash);
});
