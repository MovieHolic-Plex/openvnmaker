export type GraphScene = {
  readonly id: string;
  readonly next?: string;
  readonly choices?: readonly { readonly next: string }[];
  readonly ending?: string;
};

export type PathRange = {
  readonly min: number | null;
  readonly max: number | null;
  readonly hasCycle: boolean;
  readonly incomplete: boolean;
  readonly reachable: ReadonlySet<string>;
  readonly endingCount: number;
};

export function sceneExits(scene: GraphScene): readonly string[] {
  if (scene.choices?.length) return scene.choices.map(choice => choice.next);
  if (scene.ending) return [];
  return scene.next === undefined ? [] : [scene.next];
}

function takeClosest(pending: ReadonlySet<string>, distance: ReadonlyMap<string, number>): string | null {
  let chosen: string | null = null;
  let best = Infinity;
  for (const id of pending) {
    const value = distance.get(id);
    if (value === undefined) continue;
    if (value < best) {
      best = value;
      chosen = id;
    }
  }
  return chosen;
}

/** Shortest ending path and longest DAG path. Positive cycles make the upper bound unknown. */
export function pathRange(
  scenes: readonly GraphScene[],
  start: string,
  weights: ReadonlyMap<string, number>,
): PathRange {
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  let hasCycle = false;
  let incomplete = false;
  function visit(id: string): void {
    if (visiting.has(id)) { hasCycle = true; return; }
    if (reachable.has(id)) return;
    reachable.add(id);
    const scene = byId.get(id);
    if (scene === undefined) { incomplete = true; return; }
    visiting.add(id);
    const targets = sceneExits(scene);
    if (!targets.length && !scene.ending) incomplete = true;
    for (const target of targets) visit(target);
    visiting.delete(id);
    order.push(id);
  }
  visit(start);
  const distance = new Map<string, number>([[start, weights.get(start) ?? 0]]);
  const pending = new Set([start]);
  while (pending.size) {
    const id = takeClosest(pending, distance);
    if (id === null) break;
    pending.delete(id);
    const scene = byId.get(id);
    if (scene === undefined) continue;
    const from = distance.get(id);
    if (from === undefined) continue;
    for (const target of sceneExits(scene)) {
      const candidate = from + (weights.get(target) ?? 0);
      if (candidate < (distance.get(target) ?? Infinity)) {
        distance.set(target, candidate);
        pending.add(target);
      }
    }
  }
  const endings = scenes.filter(scene => reachable.has(scene.id) && scene.ending && !scene.choices?.length);
  const min = endings.length ? Math.min(...endings.map(scene => distance.get(scene.id) ?? Infinity)) : null;
  const longest = new Map<string, number>();
  if (!hasCycle) {
    for (const id of order) {
      const scene = byId.get(id);
      if (scene === undefined) continue;
      const targets = sceneExits(scene);
      const tail = targets.length
        ? Math.max(...targets.map(target => longest.get(target) ?? -Infinity))
        : scene.ending ? 0 : -Infinity;
      longest.set(id, (weights.get(id) ?? 0) + tail);
    }
  }
  const maximum = longest.get(start);
  return {
    min,
    max: hasCycle || incomplete || maximum === undefined || !Number.isFinite(maximum) ? null : maximum,
    hasCycle,
    incomplete,
    reachable,
    endingCount: endings.length,
  };
}
