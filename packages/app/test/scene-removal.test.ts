import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript, script, type Scene, type VnScript } from "@vnmaker/content";
import { duplicateScene, removeScene, sceneRemovalIssue } from "../src/studio/sceneOperations.js";
import { initialState } from "../src/engine/types.js";
import { reduce } from "../src/engine/reducer.js";

const scene = (id: string, exit: Partial<Scene> = {}): Scene => ({ id, background: "title", lines: [{ speaker: null, text: `${id}의 대사` }], ...exit });
const story = (scenes: Scene[]): VnScript => ({ ...script, assets: [], flags: {}, start: scenes[0]!.id, scenes });

test("deleting a duplicated ending into its original restores the ending and remains playable", () => {
  const source = story([scene("merge", { ending: "함께 남긴 엔딩" })]);
  const copied = duplicateScene(source, "merge", "copy");
  assert.equal(sceneRemovalIssue(copied, "copy", "merge"), null);
  const removed = parseScript(removeScene(copied, "copy", "merge"));
  assert.deepEqual(removed, source);
  let state = reduce(removed, initialState(removed), { type: "start" });
  // 스킵은 엔딩 앞 마지막 줄에서 멈춘다 — 독자가 직접 넘겨야 엔딩이 열린다.
  state = reduce(removed, state, { type: "skipToChoice" }); state = reduce(removed, state, { type: "advance" });
  assert.equal(state.phase, "ending"); assert.equal(state.endingTitle, "함께 남긴 엔딩");
});

test("deleting a duplicated branch restores choices and their flags without changing the original manuscript", () => {
  const source = story([scene("fork", { choices: [{ text: "기억", next: "finish", set: { remembered: true }, affection: 2 }, { text: "잊기", next: "finish", set: { remembered: false } }] }), scene("finish", { ending: "끝" })]);
  const before = JSON.stringify(source); const copied = duplicateScene(source, "fork", "copy");
  const removed = parseScript(removeScene(copied, "copy", "fork"));
  assert.deepEqual(removed, source); assert.equal(JSON.stringify(source), before);
  let state = reduce(removed, initialState(removed), { type: "start" });
  state = reduce(removed, state, { type: "skipToChoice" }); state = reduce(removed, state, { type: "choose", index: 0 });
  assert.equal(state.flags.remembered, true); assert.equal(state.affection, 2); assert.equal(state.sceneId, "finish");
});

test("linear and choice links skip the deleted bridge while other incoming links use the selected replacement", () => {
  const source = story([scene("source", { choices: [{ text: "건너기", next: "bridge", set: { crossed: true } }, { text: "남기", next: "finish" }] }), scene("bridge", { next: "finish" }), scene("other", { next: "bridge" }), scene("finish", { ending: "끝" })]);
  const removed = parseScript(removeScene(source, "bridge", "source"));
  assert.equal(removed.scenes[0]!.choices![0]!.next, "finish"); assert.deepEqual(removed.scenes[0]!.choices![0]!.set, { crossed: true });
  assert.equal(removed.scenes.find(scene => scene.id === "other")!.next, "source");
  const linear = story([scene("source", { next: "bridge" }), scene("bridge", { next: "finish" }), scene("finish", { ending: "끝" })]);
  assert.equal(removeScene(linear, "bridge", "source").scenes[0]!.next, "finish");
});

test("a branch cannot absorb an ending or another menu; unsafe candidates are rejected without mutation", () => {
  for (const exit of [{ ending: "끝" }, { choices: [{ text: "다음", next: "finish" }] }, { next: "source" }]) {
    const source = story([scene("source", { choices: [{ text: "선택", next: "target" }] }), scene("target", exit), scene("finish", { ending: "끝" })]);
    const before = JSON.stringify(source);
    assert.match(sceneRemovalIssue(source, "target", "source")!, /자기 자신/);
    assert.throws(() => removeScene(source, "target", "source")); assert.equal(JSON.stringify(source), before);
    assert.equal(sceneRemovalIssue(source, "target", "finish"), null);
  }
});

test("splicing a returning edge cannot introduce a new direct loop and inactive next fields are removed", () => {
  for (const exit of [{ next: "source" }, { next: "target" }, { choices: [{ text: "돌아옴", next: "source" }] }]) {
    const source = story([scene("source", { next: "target" }), scene("target", exit), scene("finish", { ending: "끝" })]);
    assert.ok(sceneRemovalIssue(source, "target", "source")); assert.throws(() => removeScene(source, "target", "source"));
  }
  const source = story([scene("source", { ending: "이미 끝난 장면", next: "target" }), scene("target", { ending: "삭제" })]);
  const removed = removeScene(source, "target", "source");
  assert.equal(removed.scenes[0]!.next, undefined); assert.equal(removed.scenes[0]!.ending, "이미 끝난 장면");
});

test("a replacement linked by BOTH a choice and a route repairs both through the bridge exit", () => {
  const source = { ...story([
    scene("source", { choices: [{ text: "다리", next: "bridge" }], routes: [{ when: { all: ["x"] }, next: "bridge" }], next: "finish" }),
    scene("bridge", { next: "finish" }),
    scene("finish", { ending: "끝" }),
  ]), flags: { x: false } };
  assert.equal(sceneRemovalIssue(source, "bridge", "source"), null);
  const removed = parseScript(removeScene(source, "bridge", "source"));
  const repaired = removed.scenes.find(scene => scene.id === "source")!;
  assert.equal(repaired.choices![0]!.next, "finish");
  assert.equal(repaired.routes![0]!.next, "finish", "route must not be left as next:undefined — the choiceTarget path covers it");
});
