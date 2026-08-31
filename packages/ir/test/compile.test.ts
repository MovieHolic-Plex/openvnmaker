import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNode, helloNode, parseNode } from "../src/index.js";

test("빈 대사는 노드가 되지 않는다", () => {
  assert.throws(() => helloNode("   "), /빈 대사/);
});

test("hello 노드는 scene 다음에 say 다", () => {
  const node = helloNode("  은행나무 그늘 아래로 종강 바람이 스친다.  ");
  assert.equal(node.id, "hello");
  assert.equal(node.beats.length, 2);
  assert.equal(node.beats[0]?.op, "scene");
  assert.equal(node.beats[0] && node.beats[0].op === "scene" ? node.beats[0].bg : "", "title");
  assert.equal(node.beats[1]?.op, "say");
  assert.equal(node.beats[1] && node.beats[1].op === "say" ? node.beats[1].text : "", "은행나무 그늘 아래로 종강 바람이 스친다.");
  assert.equal(node.beats[1] && node.beats[1].op === "say" ? node.beats[1].who : "x", null);
});

test("노드를 컴파일하면 PLAY 한 씬이 된다", () => {
  const script = compileNode(helloNode("은행나무 그늘."), []);
  assert.equal(script.title, "한 줄");
  assert.equal(script.start, "hello");
  assert.equal(script.scenes.length, 1);
  assert.equal(script.scenes[0]?.id, "hello");
  assert.equal(script.scenes[0]?.background, "title");
  assert.equal(script.scenes[0]?.lines[0]?.speaker, null);
  assert.equal(script.scenes[0]?.lines[0]?.text, "은행나무 그늘.");
  assert.equal(script.scenes[0]?.ending, "그 한 줄");
  assert.equal(script.characters.length, 0);
});

test("parseNode 는 id 와 beats 가 없으면 거절한다", () => {
  assert.throws(() => parseNode({}), /id/);
  assert.throws(() => parseNode({ id: "hello" }), /beats/);
  assert.throws(() => parseNode({ id: "hello", beats: "nope" }), /beats/);
});

test("노드 id 에 경로 조각이 있으면 거절한다", () => {
  assert.throws(() => parseNode({ id: "../etc", beats: [{ op: "scene", bg: "title" }] }), /id/);
  assert.throws(() => parseNode({ id: "a/b", beats: [{ op: "scene", bg: "title" }] }), /id/);
  assert.throws(() => parseNode({ id: "HELLO", beats: [{ op: "scene", bg: "title" }] }), /id/);
});
