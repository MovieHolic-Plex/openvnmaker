import assert from "node:assert/strict";
import { test } from "node:test";
import { connectEdges, diffBeats, helloNode, listGraph, upsertBeats } from "../src/index.js";

test("upsertBeats 는 say 를 갈아끼운다", () => {
  const next = upsertBeats(helloNode("따뜻하다."), [
    { op: "scene", bg: "title", bgm: "main-theme" },
    { op: "say", who: null, text: "  바람이 차갑다.  " },
  ]);
  assert.equal(next.id, "hello");
  const say = next.beats[1];
  assert.equal(say && say.op === "say" ? say.text : "", "바람이 차갑다.");
});

test("upsertBeats 는 say 없이 거절한다", () => {
  assert.throws(() => upsertBeats(helloNode("a"), [{ op: "scene", bg: "title" }]), /say/);
});

test("connect 는 from/to 를 붙이고 중복은 무시한다", () => {
  const once = connectEdges([], { from: "hello", to: "cafe-02" });
  assert.deepEqual(once, [{ from: "hello", to: "cafe-02" }]);
  const twice = connectEdges(once, { from: "hello", to: "cafe-02" });
  assert.equal(twice.length, 1);
});

test("connect 의 노드 id 에 경로가 있으면 거절한다", () => {
  assert.throws(() => connectEdges([], { from: "../x", to: "hello" }), /id/);
  assert.throws(() => connectEdges([], { from: "hello", to: "Cafe" }), /id/);
});

test("listGraph 는 id 와 엣지만 준다", () => {
  const graph = listGraph([helloNode("a")], [{ from: "hello", to: "cafe-02" }]);
  assert.deepEqual(graph.nodes, [{ id: "hello", label: "한 줄" }]);
  assert.deepEqual(graph.edges, [{ from: "hello", to: "cafe-02" }]);
});

test("비트가 바뀌면 diff 가 생긴다", () => {
  const before = helloNode("따뜻하다.").beats;
  const after = upsertBeats(helloNode("따뜻하다."), [
    { op: "scene", bg: "title", bgm: "main-theme", chapter: "HELLO" },
    { op: "say", who: null, text: "바람이 차갑다." },
  ]).beats;
  const diff = diffBeats(before, after);
  assert.equal(diff.length > 0, true);
  assert.equal(JSON.stringify(diff).includes("차갑다"), true);
});
