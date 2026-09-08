import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../src/canonical.js";
import { readBranchContext } from "../src/context.js";
import { sceneIdSchema } from "../src/primitives.js";
import {
  canonSectionSchema,
  productionDocumentSchema,
} from "../src/production-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

for (const sectionId of [
  "castCanon", "worldTimeline", "branchFacts", "artDirection",
] as const) {
  test(`canon section entity ${sectionId} agrees with the typed mutation precondition`, async () => {
    // Given nonempty sections and the CanonSection DTO convention used by mutations.
    const base = await selectionSource();
    const document = productionDocumentSchema.parse({
      ...base.productionDocument,
      castCanon: [{
        id: "voice", category: "voice", text: "Voice.",
        characterIds: ["witness"], sceneIds: [], relatedEntryIds: [],
      }],
      branchFacts: [{
        id: "route-fact", category: "branch-fact", text: "Route.",
        characterIds: [], sceneIds: ["start"], relatedEntryIds: [],
      }],
      artDirection: [{
        id: "palette", category: "visual-rule", text: "Palette.",
        characterIds: [], sceneIds: [], relatedEntryIds: [],
      }],
    });
    const sections = {
      castCanon: canonSectionSchema.parse({
        kind: "entries", entries: document.castCanon,
      }),
      worldTimeline: canonSectionSchema.parse({
        kind: "entries", entries: document.worldTimeline,
      }),
      branchFacts: canonSectionSchema.parse({
        kind: "entries", entries: document.branchFacts,
      }),
      artDirection: canonSectionSchema.parse({
        kind: "art-direction", rules: document.artDirection,
      }),
    };
    const expectedHash = await canonicalHash(sections[sectionId]);

    // When the same section entities are read through branch context.
    const result = await readBranchContext(
      { ...base, productionDocument: document },
      { sceneId: sceneIdSchema.parse("other"), maxVisitedStates: 100 },
    );

    // Then one entity identity has the same hash convention for reading and mutation.
    assert.equal(result.kind, "ready");
    const dependency = result.readSet.find(value =>
      value.kind === "entity" &&
      value.target.kind === "canon" &&
      value.target.sectionId === sectionId &&
      value.target.entryId === undefined);
    assert.ok(dependency);
    assert.equal(dependency.hash, expectedHash);
  });
}
