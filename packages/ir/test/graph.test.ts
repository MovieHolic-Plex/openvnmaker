import assert from "node:assert/strict";
import { test } from "node:test";
import { compileGraph, parseNode } from "../src/index.js";
import type { StoryEdge, StoryNode } from "../src/index.js";

function buildGraph(): { nodes: StoryNode[]; edges: StoryEdge[] } {
  const nodes: StoryNode[] = [
    parseNode({
      id: "intro-01",
      label: "갈림길",
      beats: [
        { op: "scene", bg: "campus-gate", bgm: "daily", chapter: "갈림길" },
        { op: "show", who: "yuna", slot: "left", expression: "smile" },
        { op: "say", who: "yuna", text: "오늘 방과 후, 어디로 갈까?", expression: "smile" },
        { op: "set", vars: { metYuna: true } },
        { op: "play", kind: "sfx", sound: "door-open" },
        { op: "say", who: "me", text: "나는 잠시 고민했다." },
        {
          op: "menu",
          choices: [
            { text: "미술실로 간다", to: "park-02", set: { tookLeft: true } },
            { text: "옥상으로 간다", to: "roof-03", when: "metYuna" },
          ],
        },
      ],
    }),
    parseNode({
      id: "park-02",
      label: "미술실",
      beats: [
        { op: "scene", bg: "art-studio" },
        { op: "show", who: "jiho", slot: "right", expression: "neutral" },
        { op: "say", who: "jiho", text: "붓이 멈췄다.", sfx: "brush-stroke", shake: true },
        { op: "hide", who: "jiho" },
        { op: "pause", ms: 400 },
        { op: "jump", to: "roof-03" },
      ],
    }),
    parseNode({
      id: "roof-03",
      label: "옥상",
      beats: [
        { op: "scene", bg: "rooftop-night", bgm: "ending", cg: "city-lights" },
        { op: "play", kind: "bgm", sound: "warm" },
        { op: "say", who: "yuna", text: "야경이 다 보인다.", expression: "sad" },
        { op: "ending", title: "별빛 엔딩" },
      ],
    }),
  ];
  const edges: StoryEdge[] = [
    { from: "intro-01", to: "park-02" },
    { from: "park-02", to: "roof-03" },
  ];
  return { nodes, edges };
}

test("parseBeat 는 모든 op 을 받아들이고 모르는 op 을 거절한다", () => {
  const node = parseNode({
    id: "ops-01",
    beats: [
      { op: "scene", bg: "title", cg: "memory-park" },
      { op: "say", who: "yuna", text: "바람이 분다.", expression: "smile", sfx: "cicada", shake: true },
      { op: "show", who: "yuna", slot: "left", expression: "smile", outfit: "summer" },
      { op: "hide", who: "yuna" },
      { op: "menu", choices: [{ text: "간다", to: "park-02", when: "metYuna", set: { tookLeft: true } }] },
      { op: "jump", to: "park-02" },
      { op: "set", vars: { metYuna: true } },
      { op: "play", kind: "bgm", sound: "daily", loop: true },
      { op: "play", kind: "sfx", sound: "door-open" },
      { op: "pause", ms: 300 },
      { op: "pause" },
      { op: "ending", title: "별빛 엔딩" },
    ],
  });
  assert.equal(node.beats.length, 12);
  assert.throws(() => parseNode({ id: "bad-01", beats: [{ op: "dance" }] }), /알 수 없는 beat\.op/);
});

test("menu->jump->ending 그래프를 멀티씬 VnScript 로 컴파일한다", () => {
  const { nodes, edges } = buildGraph();
  const script = compileGraph(nodes, edges, []);

  assert.equal(script.scenes.length, 3);
  assert.equal(script.start, "intro-01");
  assert.deepEqual(script.scenes.map((scene) => scene.id), ["intro-01", "park-02", "roof-03"]);

  const intro = script.scenes[0];
  assert.ok(intro);
  assert.equal(intro.background, "campus-gate");
  assert.equal(intro.bgm, "daily");
  assert.equal(intro.chapter, "갈림길");
  assert.equal(intro.choices?.length, 2);
  assert.equal(intro.choices?.[0]?.text, "미술실로 간다");
  assert.equal(intro.choices?.[0]?.next, "park-02");
  assert.deepEqual(intro.choices?.[0]?.set, { tookLeft: true });
  assert.equal(intro.choices?.[0]?.cond, undefined);
  assert.equal(intro.choices?.[1]?.next, "roof-03");
  assert.equal(intro.choices?.[1]?.cond, "metYuna");
  assert.equal(intro.next, undefined);
  assert.equal(intro.ending, undefined);
  assert.deepEqual(
    intro.sprites?.map((dir) => [dir.slot, dir.character, dir.expression]),
    [["left", "yuna", "smile"]],
  );
  assert.equal(intro.lines.length, 2);
  assert.equal(intro.lines[0]?.speaker, "yuna");
  assert.equal(intro.lines[0]?.expression, "smile");
  assert.equal(intro.lines[0]?.sfx, undefined);
  assert.equal(intro.lines[1]?.speaker, "me");
  assert.equal(intro.lines[1]?.sfx, "door-open");
  assert.deepEqual(script.flags, { metYuna: true });

  const park = script.scenes[1];
  assert.ok(park);
  assert.equal(park.next, "roof-03");
  assert.equal(park.choices, undefined);
  assert.equal(park.ending, undefined);
  assert.equal(park.lines.length, 1);
  assert.equal(park.lines[0]?.speaker, "jiho");
  assert.equal(park.lines[0]?.sfx, "brush-stroke");
  assert.equal(park.lines[0]?.shake, true);
  assert.equal(park.sprites, undefined);

  const roof = script.scenes[2];
  assert.ok(roof);
  assert.equal(roof.background, "rooftop-night");
  assert.equal(roof.bgm, "warm");
  assert.equal(roof.cg, "city-lights");
  assert.equal(roof.ending, "별빛 엔딩");
  assert.equal(roof.next, undefined);
  assert.equal(roof.lines[0]?.speaker, "yuna");
  assert.equal(roof.lines[0]?.expression, "sad");
});

test("jump 없이도 엣지로 next 를 잇는다", () => {
  const { nodes } = buildGraph();
  const mid = nodes[1];
  const end = nodes[2];
  assert.ok(mid);
  assert.ok(end);
  const midNoJump: StoryNode = { ...mid, beats: mid.beats.filter((beat) => beat.op !== "jump") };
  const script = compileGraph([midNoJump, end], [{ from: "park-02", to: "roof-03" }]);
  assert.equal(script.scenes[0]?.next, "roof-03");
  assert.equal(script.scenes[1]?.next, undefined);
});

test("엣지 없이도 jump 로 next 를 잇는다", () => {
  const { nodes } = buildGraph();
  const mid = nodes[1];
  const end = nodes[2];
  assert.ok(mid);
  assert.ok(end);
  const script = compileGraph([mid, end], []);
  assert.equal(script.scenes[0]?.next, "roof-03");
});
