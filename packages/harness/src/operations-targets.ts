import type { Scene } from "@vnmaker/content";
import type { Candidate } from "./operations.js";

/** Validate the complete private choice list before publishing or assembling it. */
export function hasRegisteredChoiceDestinations(
  candidate: Pick<Candidate, "script" | "productionDocument">,
  scene: Pick<Scene, "choices">,
): boolean {
  const destinations = new Set([
    ...candidate.script.scenes.map(row => row.id),
    ...candidate.productionDocument.outline.scenes.map(row => row.id),
  ]);
  return (scene.choices ?? []).every(choice => destinations.has(choice.next));
}
