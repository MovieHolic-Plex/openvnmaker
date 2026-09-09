import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalHash, parseProductionDocument, parseToolEnvelope, scriptSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectFixture } from "./operations-project-fixture.js";

const canonReferences = [
  { sectionId: "castCanon", applicability: { anyOf: [{ all: ["spare"] }] } },
  { sectionId: "worldTimeline", applicability: { anyOf: [{ none: ["spare"] }] } },
  {
    sectionId: "branchFacts",
    applicability: { anyOf: [{ compare: [{ flag: "spare", op: "eq", value: false }] }] },
  },
  {
    sectionId: "artDirection",
    applicability: { anyOf: [{ all: ["ready"] }, { none: ["spare"] }] },
  },
] as const;

for (const reference of canonReferences) {
  test(`rejects state removal when ${reference.sectionId} applicability references it`, async () => {
    // Given
    const f = await projectFixture();
    const candidate = {
      ...f.input.candidate,
      productionDocument: parseProductionDocument({
        ...f.input.candidate.productionDocument,
        [reference.sectionId]: [{
          id: "conditional-fact", category: "world-fact", text: "Conditional fact",
          characterIds: [], sceneIds: [], relatedEntryIds: [],
          applicability: reference.applicability,
        }],
      }),
    };
    const before = structuredClone(candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "patch_state",
      arguments: {
        expectedStateHash: f.stateHash,
        declare: [{ id: "added", value: true }], setInitial: [],
        remove: [{ id: "spare", expectedValue: false }],
      },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "REFERENCED_ENTITY");
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(candidate, before);
  });
}

const outlineReferences = [
  { name: "choice all", choice: { when: { all: ["spare"] } } },
  { name: "choice none", choice: { when: { none: ["spare"] } } },
  {
    name: "choice comparison",
    choice: { when: { compare: [{ flag: "spare", op: "eq", value: 0 }] } },
  },
  { name: "choice assignment", choice: { set: { spare: 1 } } },
  { name: "choice increment", choice: { add: { spare: 1 } } },
  {
    name: "ending route state",
    outcome: {
      endingId: "end", requiredRouteState: { spare: 0 },
      resolution: "Resolution", cost: "Cost", relationshipChanges: [], openThreads: [],
    },
  },
] as const;

for (const reference of outlineReferences) {
  test(`rejects state removal when an outline ${reference.name} references it`, async () => {
    // Given
    const f = await projectFixture();
    const flags = { ...f.flags, spare: 0 };
    const candidate = {
      ...f.input.candidate,
      script: scriptSchema.parse({ ...f.input.candidate.script, flags }),
      productionDocument: parseProductionDocument({
        ...f.input.candidate.productionDocument,
        outline: {
          ...f.input.candidate.productionDocument.outline,
          scenes: [{
            id: "start", chapter: "One", title: "Planned start", summary: "Beat",
            artDirection: "Geometry", targetMinutes: 1, background: "title",
            choices: "choice" in reference ? [{
              id: "planned-choice", text: "Planned choice", next: "end", ...reference.choice,
            }] : [],
          }],
          endingOutcomes: "outcome" in reference ? [reference.outcome] : [],
        },
      }),
    };
    const before = structuredClone(candidate);
    const envelope = parseToolEnvelope({
      ...f.common, tool: "patch_state",
      arguments: {
        expectedStateHash: await canonicalHash(flags),
        declare: [{ id: "added", value: true }], setInitial: [],
        remove: [{ id: "spare", expectedValue: 0 }],
      },
    });

    // When
    const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });

    // Then
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.code, "REFERENCED_ENTITY");
    assert.deepEqual(outcome.candidate, before);
    assert.deepEqual(candidate, before);
  });
}

test("allows state removal when its name appears only in production text and entry identity", async () => {
  // Given
  const f = await projectFixture();
  const candidate = {
    ...f.input.candidate,
    productionDocument: parseProductionDocument({
      ...f.input.candidate.productionDocument,
      brief: "spare",
      worldTimeline: [{
        id: "spare", category: "world-fact", text: "spare",
        characterIds: [], sceneIds: [], relatedEntryIds: [],
      }],
    }),
  };
  const before = structuredClone(candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_state",
    arguments: {
      expectedStateHash: f.stateHash, declare: [], setInitial: [],
      remove: [{ id: "spare", expectedValue: false }],
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, candidate, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.deepEqual(outcome.candidate.script.flags, { ready: true, coins: 1 });
  assert.deepEqual(outcome.candidate.productionDocument, before.productionDocument);
  assert.deepEqual(candidate, before);
});
