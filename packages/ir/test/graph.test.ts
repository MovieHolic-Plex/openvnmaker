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
        { op: "play", kind: "sfx", sound: "door-open" },
        { op: "say", who: "me", text: "나는 잠시 고민했다." },
        {
          op: "menu",
          choices: [
            { text: "미술실로 간다", to: "park-02", set: { tookLeft: true } },
            { text: "옥상으로 간다", to: "roof-03" },
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
  // intro-01 은 menu 가 분기를 정한다 — 엣지를 더하면 어느 쪽이 이을지 모호해져 거부된다.
  const edges: StoryEdge[] = [{ from: "park-02", to: "roof-03" }];
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
  assert.equal(intro.choices?.[1]?.cond, undefined);
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
  assert.equal(script.flags, undefined);

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

/* 분기 의미 (2026-09 결정): 조건 엣지는 순서대로 평가되는 scene.routes 가 되고,
   무조건 엣지는 폴백 next 다. 무조건 출구는 하나만 허용한다. */

const sayOnly = (id: string): StoryNode => ({
  id,
  beats: [{ op: "say", who: null, text: `${id} 대사` }],
});

test("조건 엣지는 scene.routes 로 컴파일된다 — 문자열 플래그명은 {all:[name]} 으로 읽는다", () => {
  const script = compileGraph(
    [sayOnly("a"), sayOnly("b"), sayOnly("c")],
    [
      { from: "a", to: "b", when: { all: ["metYuna"] } },
      { from: "a", to: "c" },
    ],
  );
  const a = script.scenes[0];
  assert.ok(a);
  assert.deepEqual(a.routes, [{ next: "b", when: { all: ["metYuna"] } }]);
  assert.equal(a.next, "c");
});

test("무조건 엣지가 둘이면 거부한다 — 뒤는 영원히 도달 불가", () => {
  assert.throws(
    () => compileGraph([sayOnly("a"), sayOnly("b"), sayOnly("c")], [{ from: "a", to: "b" }, { from: "a", to: "c" }]),
    /무조건 엣지가 여러 개/,
  );
});

test("표현식형 문자열 when 은 거부한다 — 플래그명 문자열만 {all} 로 읽는다", () => {
  assert.throws(
    () => compileGraph([sayOnly("a"), sayOnly("b")], [{ from: "a", to: "b", when: "metYuna && !done" } as StoryEdge]),
    /문자열 when/,
  );
});

test("엔딩과 조건 경로는 공존한다 — 경로 실패 시 엔딩으로 폴백", () => {
  const node: StoryNode = {
    id: "a",
    beats: [
      { op: "say", who: null, text: "끝이 보인다" },
      { op: "ending", title: "조용한 엔딩" },
    ],
  };
  const script = compileGraph([node, sayOnly("b")], [{ from: "a", to: "b", when: { all: ["metYuna"] } }]);
  const a = script.scenes[0];
  assert.ok(a);
  assert.deepEqual(a.routes, [{ next: "b", when: { all: ["metYuna"] } }]);
  assert.equal(a.ending, "조용한 엔딩");
  assert.equal(a.next, undefined);
});

test("엔딩과 무조건 출구가 공존하면 거부한다 — 어느 쪽이든 죽는다", () => {
  const node: StoryNode = {
    id: "a",
    beats: [
      { op: "say", who: null, text: "끝이 보인다" },
      { op: "ending", title: "조용한 엔딩" },
    ],
  };
  assert.throws(() => compileGraph([node, sayOnly("b")], [{ from: "a", to: "b" }]), /엔딩과 무조건 출구/);
});

test("엣지가 없는 노드를 가리키면 거부한다", () => {
  assert.throws(
    () => compileGraph([sayOnly("a")], [{ from: "a", to: "ghost" }]),
    /없는 노드/,
  );
});

test("조건 경로가 없는 노드를 가리키면 거부한다", () => {
  assert.throws(
    () => compileGraph([sayOnly("a")], [{ from: "a", to: "ghost", when: { all: ["x"] } }]),
    /없는 노드/,
  );
});

test("선택지와 다른 출구가 공존하면 거부한다 — 분기는 선택지만 정한다", () => {
  const node: StoryNode = {
    id: "a",
    beats: [
      { op: "say", who: null, text: "고른다" },
      { op: "menu", choices: [{ text: "간다", to: "b" }] },
    ],
  };
  assert.throws(() => compileGraph([node, sayOnly("b")], [{ from: "a", to: "b" }]), /선택지와 다른 출구/);
});

test("menu.when 문자열은 플래그 조건으로, set 비트는 장면 진입 플래그로 컴파일된다", () => {
  const node: StoryNode = {
    id: "a",
    beats: [
      { op: "say", who: null, text: "고른다" },
      { op: "set", vars: { visited: true } },
      { op: "menu", choices: [
        // 직접 만든 노드는 파서를 우회한다 — 구버전 문자열 when 도 컴파일에서 정규화돼야 한다.
        { text: "간다", to: "b", when: "metYuna" as unknown as import("../src/index.js").LineCondition },
        { text: "구조화", to: "c", when: { compare: [{ flag: "score", op: "gte", value: 3 }] } },
      ] },
    ],
  };
  const script = compileGraph([node, sayOnly("b"), sayOnly("c")], []);
  const a = script.scenes[0];
  assert.ok(a);
  assert.deepEqual(a.set, { visited: true });
  assert.deepEqual(a.choices?.[0]?.when, { all: ["metYuna"] });
  assert.deepEqual(a.choices?.[1]?.when, { compare: [{ flag: "score", op: "gte", value: 3 }] });
});

test("say 비트가 없는 노드는 거부한다 — 빈 장면은 만들 수 없다", () => {
  const node: StoryNode = {
    id: "a",
    beats: [{ op: "menu", choices: [{ text: "간다", to: "b" }] }],
  };
  assert.throws(() => compileGraph([node, sayOnly("b")], []), /say 비트/);
});

test("등록되지 않은 화자는 등장인물로 올려 parseScript 를 통과하게 한다", () => {
  const script = compileGraph([sayOnly("a")], [], []);
  assert.equal(script.characters.length, 0);
  const withSpeaker = compileGraph([{
    id: "a",
    beats: [
      { op: "say", who: "yuna", text: "안녕" },
      { op: "say", who: "me", text: "나" },
      { op: "say", who: null, text: "내레이션" },
    ],
  }], [], []);
  assert.deepEqual(withSpeaker.characters.map(actor => actor.id), ["yuna"]);
});

test("URL 자산 — scene.bg 가 /로 시작하면 backgroundUrl 로 나간다", () => {
  const url = "/assets/user/" + "a".repeat(64) + ".png";
  const script = compileGraph([parseNode({
    id: "u-01",
    beats: [
      { op: "scene", bg: url, cg: url },
      { op: "say", who: null, text: "설치한 배경이다.", bg: url, cg: url },
      { op: "ending", title: "끝" },
    ],
  })], [], []);
  const scene = script.scenes[0]!;
  assert.equal(scene.background, "title", "배경 id 자리는 내장 기본값을 유지한다");
  assert.equal(scene.backgroundUrl, url);
  assert.equal(scene.cgUrl, url);
  assert.equal(scene.cg, undefined);
  assert.equal(scene.lines[0]!.backgroundUrl, url);
  assert.equal(scene.lines[0]!.cgUrl, url);
});

test("URL 자산 — 잘못된 주소는 컴파일이 아니라 파싱에서 거부한다", () => {
  assert.throws(() => parseNode({ id: "x", beats: [{ op: "say", who: null, text: "t", bg: "https://evil.example/x.png" }] }), /say\.bg/);
  assert.throws(() => parseNode({ id: "x", beats: [{ op: "show", who: "a", slot: "left", expression: "neutral", image: "relative.png" }] }), /show\.image/);
});

test("show.image 는 스프라이트 poseUrl 로 나간다", () => {
  const url = "/assets/user/" + "b".repeat(64) + ".webp";
  const script = compileGraph([parseNode({
    id: "u-02",
    beats: [
      { op: "scene", bg: "title" },
      { op: "show", who: "yuna", slot: "left", expression: "neutral", image: url },
      { op: "say", who: "yuna", text: "임의 포즈다." },
      { op: "ending", title: "끝" },
    ],
  })], [], []);
  assert.equal(script.scenes[0]!.sprites?.[0]?.poseUrl, url);
});
