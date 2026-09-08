import type { ChoiceId, SceneId } from "./primitives.js";
import type { ProductionOutline } from "./production-contracts.js";

export type OutlineDagFailure =
  | "DUPLICATE_SCENE_ID"
  | "START_NOT_FOUND"
  | "DUPLICATE_CHOICE_ID"
  | "INVALID_SCENE_EXIT"
  | "TARGET_NOT_FOUND"
  | "OUTLINE_CYCLE"
  | "UNREACHABLE_SCENE";

export type OutlineDagResult =
  | {
      readonly kind: "ready";
      readonly outline: ProductionOutline;
    }
  | {
      readonly kind: "blocked";
      readonly reason: OutlineDagFailure;
    };

/** Local graph construction and indegree reduction are intentionally mutable. */
type OutlineNode = {
  readonly scene: ProductionOutline["scenes"][number];
  readonly outgoing: OutlineNode[];
  incoming: number;
};

/** Structural approval prerequisite only; profile limits and approval are separate. */
export function validateOutlineDag(
  outline: ProductionOutline,
): OutlineDagResult {
  const nodes = new Map<SceneId, OutlineNode>();
  for (const scene of outline.scenes) {
    if (nodes.has(scene.id)) {
      return { kind: "blocked", reason: "DUPLICATE_SCENE_ID" };
    }
    nodes.set(scene.id, { scene, outgoing: [], incoming: 0 });
  }
  const start = nodes.get(outline.start);
  if (!start) return { kind: "blocked", reason: "START_NOT_FOUND" };

  for (const node of nodes.values()) {
    const scene = node.scene;
    const choiceIds = new Set<ChoiceId>();
    for (const choice of scene.choices ?? []) {
      if (choice.id === undefined) continue;
      if (choiceIds.has(choice.id)) {
        return { kind: "blocked", reason: "DUPLICATE_CHOICE_ID" };
      }
      choiceIds.add(choice.id);
    }
    const exits = Number(scene.next !== undefined) +
      Number((scene.choices?.length ?? 0) > 0) +
      Number(Boolean(scene.ending));
    if (exits !== 1) {
      return { kind: "blocked", reason: "INVALID_SCENE_EXIT" };
    }
    const destinations = scene.choices?.length
      ? scene.choices.map(choice => choice.next)
      : scene.next === undefined ? [] : [scene.next];
    for (const destination of destinations) {
      const target = nodes.get(destination);
      if (!target) return { kind: "blocked", reason: "TARGET_NOT_FOUND" };
      node.outgoing.push(target);
      target.incoming += 1;
    }
  }

  // Check every component before reachability so disconnected cycles are detected.
  const available = [...nodes.values()].filter(node => node.incoming === 0);
  let processed = 0;
  for (const node of available) {
    processed += 1;
    for (const target of node.outgoing) {
      target.incoming -= 1;
      if (target.incoming === 0) available.push(target);
    }
  }
  if (processed !== nodes.size) {
    return { kind: "blocked", reason: "OUTLINE_CYCLE" };
  }

  const reachable = new Set<OutlineNode>([start]);
  const pending = [start];
  for (const node of pending) {
    for (const target of node.outgoing) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      pending.push(target);
    }
  }
  if (reachable.size !== nodes.size) {
    return { kind: "blocked", reason: "UNREACHABLE_SCENE" };
  }
  return { kind: "ready", outline };
}
