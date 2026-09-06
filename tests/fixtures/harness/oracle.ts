/** Independent recipe: no generator, script, reducer, selector or condition-helper imports. */
export const ROUTE_RECIPE = [
  { id: "000", a: false, b: false, c: false, score: 0, end: 0 },
  { id: "001", a: false, b: false, c: true, score: 4, end: 1 },
  { id: "010", a: false, b: true, c: false, score: 2, end: 0 },
  { id: "011", a: false, b: true, c: true, score: 6, end: 2 },
  { id: "100", a: true, b: false, c: false, score: 1, end: 0 },
  { id: "101", a: true, b: false, c: true, score: 5, end: 1 },
  { id: "110", a: true, b: true, c: false, score: 3, end: 1 },
  { id: "111", a: true, b: true, c: true, score: 7, end: 2 },
] as const;

export function routeOracle() {
  return ROUTE_RECIPE.map(row => {
    const visitedSceneIds = [...Array.from({ length: 77 }, (_, i) => `s${String(i + 1).padStart(3, "0")}`), `s0${78 + row.end}`];
    const choices = [
      { sceneId: "s020", choiceId: `a-${Number(row.a)}` },
      { sceneId: "s040", choiceId: `b-${Number(row.b)}` },
      { sceneId: "s060", choiceId: `c-${Number(row.c)}` },
      { sceneId: "s077", choiceId: `finish-${row.end}` },
    ];
    const menus = [["a-0", "a-1"], ["b-0", "b-1"], ["c-0", "c-1"], [`finish-${row.end}`]];
    const historyIds = visitedSceneIds.flatMap(scene => [
      ...Array.from({ length: 75 }, (_, i) => i + 1)
        .filter(line => scene !== "s041" || line !== (row.a ? 74 : 75))
        .map(line => `${scene}/line/l${String(line).padStart(3, "0")}`),
      ...choices.filter(choice => choice.sceneId === scene).map(choice => `${scene}/choice/${choice.choiceId}`),
    ]);
    return { id: row.id, choices, menus, flags: { a: row.a, b: row.b, c: row.c, score: row.score },
      ending: `ending-${row.end}`, endingSceneId: `s0${78 + row.end}`, visitedSceneIds, historyIds } as const;
  });
}
export type RouteExpectation = ReturnType<typeof routeOracle>[number];
