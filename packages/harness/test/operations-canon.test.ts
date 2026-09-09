import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  canonicalHash, canonSectionSchema, characterIdSchema, hashSchema,
  parseProductionDocument, parseToolEnvelope, sceneIdSchema,
  scriptSchema, writeSetSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectFixture } from "./operations-project-fixture.js";

async function canonFixture() {
  const f = await projectFixture();
  const fact = {
    id: "fact-a", category: "world-fact", text: "Prior fact",
    characterIds: [], sceneIds: ["start"], relatedEntryIds: [],
  };
  const rule = { ...fact, id: "visual-a", category: "visual-rule" };
  const document = parseProductionDocument({
    ...f.input.candidate.productionDocument,
    worldTimeline: [fact], artDirection: [rule],
  });
  const sections = {
    worldTimeline: { kind: "entries", entries: [fact] },
    artDirection: { kind: "art-direction", rules: [rule] },
    outline: { kind: "outline", outline: document.outline },
  } as const;
  const replacements = {
    worldTimeline: {
      kind: "entries",
      entries: [fact, {
        ...fact, id: "fact-b", text: "Proposed fact",
        sceneIds: ["end"], relatedEntryIds: ["fact-a"],
      }],
    },
    artDirection: {
      kind: "art-direction",
      rules: [{ ...rule, id: "visual-b", sceneIds: ["end"] }],
    },
    outline: {
      kind: "outline",
      outline: {
        ...document.outline,
        scenes: [
          {
            id: "start", chapter: "One", title: "Start", summary: "Start beat",
            artDirection: "Geometry", targetMinutes: 1, background: "title", next: "end",
          },
          {
            id: "end", chapter: "One", title: "End", summary: "End beat",
            artDirection: "Geometry", targetMinutes: 1, background: "title", ending: "End",
          },
        ],
      },
    },
    dangling: {
      kind: "entries", entries: [{ ...fact, sceneIds: ["missing-scene"] }],
    },
  } as const;
  const input = {
    ...f.input,
    candidate: {
      ...f.input.candidate,
      productionDocument: document,
      script: scriptSchema.parse({
        ...f.input.candidate.script,
        characters: [{ id: "observer", name: "Observer", color: "#112233", bio: "" }],
        scenes: [...f.input.candidate.script.scenes, {
          id: "side", background: "title", ending: "Side",
          lines: [{ id: "l-a", speaker: null, text: "Unrelated scene" }],
        }],
      }),
    },
    authorizedWriteSet: writeSetSchema.parse(
      ["worldTimeline", "artDirection", "outline", "absent"].map(sectionId => ({
        target: { kind: "canon", sectionId }, fields: ["proposal"],
      })),
    ),
  };
  return { input, common: f.common, sections, replacements };
}

test("preserves scoped canon identities when another section uses the same entry ID", async () => {
  // Given
  const f = await canonFixture();
  const candidate = {
    ...f.input.candidate,
    productionDocument: parseProductionDocument({
      ...f.input.candidate.productionDocument,
      artDirection: f.input.candidate.productionDocument.artDirection.map(
        rule => ({ ...rule, id: "fact-a" }),
      ),
    }),
  };
  const before = structuredClone(candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "propose_canon",
    arguments: {
      sectionId: "worldTimeline",
      expectedSectionHash: await canonicalHash(f.sections.worldTimeline),
      replacement: f.replacements.worldTimeline, reason: "Scoped revision",
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.candidate, before);
  assert.deepEqual(candidate, before);
});

const artifactSchema = z.object({
  kind: z.literal("canon-proposal"),
  artifactHash: hashSchema,
  sectionId: z.string(),
  expectedSectionHash: hashSchema,
  replacement: canonSectionSchema,
  reason: z.string(),
  affectedSceneIds: z.array(sceneIdSchema),
  affectedCharacterIds: z.array(characterIdSchema),
});

for (const sectionId of ["worldTimeline", "artDirection", "outline"] as const) {
  test(`creates a review artifact without promoting canon when ${sectionId} is proposed`, async () => {
    // Given
    const f = await canonFixture();
    const before = structuredClone(f.input.candidate);
    const request = {
      sectionId,
      expectedSectionHash: await canonicalHash(f.sections[sectionId]),
      replacement: f.replacements[sectionId],
      reason: "Requested revision",
    };
    const expectedArtifactHash = await canonicalHash({ kind: "canon-proposal", ...request });
    const envelope = parseToolEnvelope({
      ...f.common, tool: "propose_canon", arguments: request,
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, envelope });

    // Then
    assert.equal(outcome.result.ok, true);
    assert.equal(outcome.result.changed, false);
    assert.deepEqual(outcome.result.writeSet, []);
    const artifact = artifactSchema.parse(outcome.result.data);
    assert.equal(artifact.artifactHash, expectedArtifactHash);
    assert.equal(artifact.sectionId, sectionId);
    assert.equal(artifact.expectedSectionHash, request.expectedSectionHash);
    assert.deepEqual(artifact.replacement, request.replacement);
    assert.equal(artifact.reason, request.reason);
    assert.deepEqual([...artifact.affectedSceneIds].sort(), ["end", "start"]);
    assert.deepEqual(artifact.affectedCharacterIds, []);
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(f.input.candidate, before);
  });
}

const failures = [
  {
    name: "section is absent", sectionId: "absent", replacement: "worldTimeline",
    staleHash: false, authorized: true, revision: 4, code: "STALE_TARGET",
  },
  {
    name: "section hash is stale", sectionId: "worldTimeline", replacement: "worldTimeline",
    staleHash: true, authorized: true, revision: 4, code: "STALE_TARGET",
  },
  {
    name: "proposal scope is absent", sectionId: "worldTimeline", replacement: "worldTimeline",
    staleHash: false, authorized: false, revision: 4, code: "WRITE_SCOPE_DENIED",
  },
  {
    name: "section kind changes", sectionId: "worldTimeline", replacement: "outline",
    staleHash: false, authorized: true, revision: 4, code: "INVALID_OPERATION",
  },
  {
    name: "a referenced scene is unregistered", sectionId: "worldTimeline", replacement: "dangling",
    staleHash: false, authorized: true, revision: 4, code: "INVALID_OPERATION",
  },
  {
    name: "candidate revision is stale", sectionId: "worldTimeline", replacement: "worldTimeline",
    staleHash: false, authorized: true, revision: 3, code: "STALE_HEAD",
  },
] as const;

for (const scenario of failures) {
  test(`rejects canon proposal when ${scenario.name}`, async () => {
    // Given
    const f = await canonFixture();
    const before = structuredClone(f.input.candidate);
    const envelope = parseToolEnvelope({
      ...f.common, expectedCandidateRevision: scenario.revision, tool: "propose_canon",
      arguments: {
        sectionId: scenario.sectionId,
        expectedSectionHash: scenario.staleHash
          ? "b".repeat(64) : await canonicalHash(f.sections.worldTimeline),
        replacement: f.replacements[scenario.replacement], reason: "Rejected request",
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
