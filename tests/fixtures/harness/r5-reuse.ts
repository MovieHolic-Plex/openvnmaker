import { scriptSchema } from "@vnmaker/harness";
import { generateMedium } from "./medium.js";
import { fixtureHead } from "./heads.js";

export async function reuseFixtures() {
  const original = generateMedium();
  const unrelated = scriptSchema.parse({ ...original, scenes: original.scenes.map(scene => scene.id === "s070"
    ? { ...scene, lines: scene.lines.map(line => line.id === "l001" ? { ...line, text: "Synthetic unrelated human edit" } : line) } : scene) });
  const collision = scriptSchema.parse({ ...unrelated, scenes: unrelated.scenes.map(scene => scene.id === "s001"
    ? { ...scene, lines: [...scene.lines, { id: "candidate-new", speaker: null, text: "Synthetic human ID collision" }] } : scene) });
  const candidateInsertion = { sceneId: "s001", clientKey: "candidate-insertion", assignedLineId: "candidate-new",
    value: { speaker: null, text: "Synthetic preserved candidate output" }, gap: { leftId: "l075", rightId: null } } as const;
  return { original, unrelated, collision, candidateInsertion, h0: await fixtureHead(original), h1: await fixtureHead(unrelated, 1),
    collisionHead: await fixtureHead(collision, 2), expected: { oldProposalApply: "STALE_HEAD", unrelatedReuse: "eligible",
      collisionReuse: "conflict", generationCallsForReuse: 0, newApprovalRequired: true, preservedSceneId: "s070" } } as const;
}
