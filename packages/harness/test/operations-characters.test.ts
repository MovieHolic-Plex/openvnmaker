import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  canonicalHash, parseProductionDocument, parseToolEnvelope,
  scriptSchema, writeSetSchema,
} from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectFixture } from "./operations-project-fixture.js";

async function characterFixture() {
  const f = await projectFixture();
  const ada = {
    id: "ada", name: "Ada", color: "#112233", bio: "Original profile",
    outfits: ["Coat"], chromaKey: "#00ff00",
  };
  const bea = { id: "bea", name: "Bea", color: "#445566", bio: "Other profile" };
  const cy = { id: "cy", name: "Cy", color: "#778899", bio: "New profile" };
  const candidate = {
    ...f.input.candidate,
    script: scriptSchema.parse({
      ...f.input.candidate.script, characters: [ada, bea],
      scenes: f.input.candidate.script.scenes.map(scene => ({
        ...scene, lines: scene.lines.map(line => ({ ...line, speaker: "ada" })),
      })),
    }),
    productionDocument: parseProductionDocument({
      ...f.input.candidate.productionDocument,
      castCanon: [{
        id: "ada-profile", category: "voice", text: "Voice notes",
        characterIds: ["ada"], sceneIds: [], relatedEntryIds: [],
      }],
      worldTimeline: [{
        id: "ada-belief", category: "world-fact", text: "A character belief",
        characterIds: [], sceneIds: [], relatedEntryIds: [],
        truth: { kind: "belief", holderCharacterId: "ada" },
      }],
      artDirection: [{
        id: "bea-style", category: "visual-rule", text: "Other character notes",
        characterIds: ["bea"], sceneIds: [], relatedEntryIds: [],
      }],
    }),
  };
  const input = {
    ...f.input, candidate,
    authorizedWriteSet: writeSetSchema.parse(
      ["ada", "cy"].map(characterId => ({
        target: { kind: "character", characterId }, fields: ["value"],
      })),
    ),
  };
  return { input, common: f.common, ada, bea, cy };
}

const impactSchema = z.object({ affectedCanonEntryIds: z.array(z.string()) });

test("creates a character when the null precondition and character scope match", async () => {
  // Given
  const f = await characterFixture();
  const before = structuredClone(f.input.candidate);
  const envelope = parseToolEnvelope({
    ...f.common, tool: "upsert_character",
    arguments: { characterId: "cy", expectedCharacterHash: null, value: f.cy },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  assert.deepEqual(outcome.candidate.script, {
    ...before.script, characters: [...before.script.characters, f.cy],
  });
  assert.deepEqual(outcome.candidate.productionDocument, before.productionDocument);
  assert.deepEqual(f.input.candidate, before);
});

test("updates only the matching character and reports affected canon when its hash matches", async () => {
  // Given
  const f = await characterFixture();
  const before = structuredClone(f.input.candidate);
  const value = { ...f.ada, name: "Revised Ada" };
  const envelope = parseToolEnvelope({
    ...f.common, tool: "upsert_character",
    arguments: {
      characterId: "ada", expectedCharacterHash: await canonicalHash(f.ada), value,
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.candidate.ref.revision, 5);
  assert.deepEqual(outcome.candidate.script, {
    ...before.script, characters: [value, f.bea],
  });
  const impact = impactSchema.parse(outcome.result.data);
  assert.deepEqual([...impact.affectedCanonEntryIds].sort(), ["ada-belief", "ada-profile"]);
  assert.deepEqual(outcome.candidate.productionDocument, before.productionDocument);
  assert.deepEqual(f.input.candidate, before);
});

test("keeps revision and canon impact unchanged when a character upsert is a no-op", async () => {
  // Given
  const f = await characterFixture();
  const envelope = parseToolEnvelope({
    ...f.common, tool: "upsert_character",
    arguments: {
      characterId: "ada", expectedCharacterHash: await canonicalHash(f.ada), value: f.ada,
    },
  });

  // When
  const outcome = await applyCandidateTool({ ...f.input, envelope });

  // Then
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.changed, false);
  assert.deepEqual(outcome.result.writeSet, []);
  assert.deepEqual(impactSchema.parse(outcome.result.data).affectedCanonEntryIds, []);
  assert.deepEqual(outcome.candidate, f.input.candidate);
});

const failures = [
  {
    name: "null targets an existing character",
    characterId: "ada", expectedHash: null, authorized: true, code: "STALE_TARGET",
  },
  {
    name: "the existing character hash changed",
    characterId: "ada", expectedHash: "b".repeat(64), authorized: true, code: "STALE_TARGET",
  },
  {
    name: "a non-null precondition targets a missing character",
    characterId: "cy", expectedHash: "b".repeat(64), authorized: true, code: "STALE_TARGET",
  },
  {
    name: "the unit has no character grant",
    characterId: "ada", expectedHash: undefined, authorized: false, code: "WRITE_SCOPE_DENIED",
  },
] as const;

for (const scenario of failures) {
  test(`rejects character upsert when ${scenario.name}`, async () => {
    // Given
    const f = await characterFixture();
    const before = structuredClone(f.input.candidate);
    const characters = { ada: f.ada, cy: f.cy };
    const value = characters[scenario.characterId];
    const envelope = parseToolEnvelope({
      ...f.common, tool: "upsert_character",
      arguments: {
        characterId: scenario.characterId, value,
        expectedCharacterHash: scenario.expectedHash === undefined
          ? await canonicalHash(value) : scenario.expectedHash,
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
