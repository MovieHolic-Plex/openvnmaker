import { canonEntrySchema, approvedArtBindingSchema } from "@vnmaker/harness";
import { byteHash, syntheticPng } from "./media.js";

export function qualityFixtures() {
  const facts = [
    { id: "world-locked", truth: { kind: "world" }, text: "Synthetic door is locked" },
    { id: "belief-open", truth: { kind: "belief", holderCharacterId: "actor-0" }, text: "Synthetic actor believes the door is open" },
    { id: "rumour-open", truth: { kind: "rumour" }, text: "Synthetic rumour says the door is open" },
    { id: "route-a-secret", truth: { kind: "world" }, text: "Synthetic route A secret", applicability: { anyOf: [{ all: ["a"] }] } },
  ].map(entry => canonEntrySchema.parse({ ...entry, category: "branch-fact", characterIds: ["actor-0"], sceneIds: ["s041"], relatedEntryIds: [] }));
  const alpha = syntheticPng(80, true);
  const wrongAlpha = syntheticPng(80, false);
  const wrongSprite = syntheticPng(85, true);
  const binding = approvedArtBindingSchema.parse({ assetId: "synthetic-reference-0", originalHash: byteHash(alpha), deliveryHash: byteHash(alpha),
    referenceVersionIds: ["reference-v1"], role: "expression", target: { kind: "character", characterId: "actor-0", expression: "e0" } });
  return { facts, alpha, wrongAlpha, wrongSprite, binding,
    wrongBinding: approvedArtBindingSchema.parse({ ...binding, deliveryHash: byteHash(wrongSprite), target: { kind: "character", characterId: "actor-1", expression: "e0" } }),
    expected: { globalWorldIds: ["world-locked"], routeAWorldIds: ["world-locked", "route-a-secret"],
      beliefIds: ["belief-open"], rumourIds: ["rumour-open"], alpha: [0, 255, 128, 255],
      opaqueGreenPixel: [0, 255, 0, 255], wrongAlpha: [255, 255, 255, 255],
      wrongCast: "REFERENCE_IDENTITY_MISMATCH", wrongAlphaCode: "ALPHA_NOT_PRESERVED" } } as const;
}
