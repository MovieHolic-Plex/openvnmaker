import assert from "node:assert/strict";
import { test } from "node:test";
import type { VnScript } from "@vnmaker/content";
import { reduce } from "../src/engine/reducer.js";
import { initialState } from "../src/engine/types.js";
import { spritesAt } from "../src/engine/selectors.js";

const fixture: VnScript = {
  title: "테스트",
  subtitle: "fixture",
  start: "a",
  characters: [{ id: "seorin", name: "한서린", color: "#000", bio: "" }],
  scenes: [
    {
      id: "a",
      background: "title",
      lines: [
        { speaker: null, text: "첫 줄" },
        { speaker: "seorin", text: "둘째 줄", expression: "smile" },
      ],
      sprites: [{ slot: "center", character: "seorin", expression: "neutral" }],
      choices: [
        { text: "좋은 쪽", next: "b", affection: 2 },
        { text: "다른 쪽", next: "c" },
      ],
    },
    { id: "b", background: "title", lines: [{ speaker: null, text: "b" }], ending: "좋은 끝" },
    { id: "c", background: "title", lines: [{ speaker: null, text: "c" }], next: "missing-scene" },
  ],
};

test("start 는 첫 씬 첫 줄에서 시작한다", () => {
  const s = reduce(fixture, initialState(fixture), { type: "start" });
  assert.equal(s.phase, "scene");
  assert.equal(s.sceneId, "a");
  assert.equal(s.lineIndex, 0);
});

test("advance 는 줄을 넘기고 기록을 쌓는다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "advance" });
  assert.equal(s.lineIndex, 1);
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0]?.text, "첫 줄");
});

test("마지막 줄 다음에는 선택지 단계로 넘어간다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "advance" });
  s = reduce(fixture, s, { type: "advance" });
  assert.equal(s.phase, "choice");
});

test("선택지는 호감도를 더하고 대상 씬으로 점프한다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipScene" });
  s = reduce(fixture, s, { type: "choose", index: 0 });
  assert.equal(s.sceneId, "b");
  assert.equal(s.affection, 2);
  assert.equal(s.lineIndex, 0);
});

test("호감도 없는 선택지는 0 을 더한다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipScene" });
  s = reduce(fixture, s, { type: "choose", index: 1 });
  assert.equal(s.sceneId, "c");
  assert.equal(s.affection, 0);
});

test("ending 이 있는 씬을 지나면 엔딩 단계가 된다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipScene" });
  s = reduce(fixture, s, { type: "choose", index: 0 });
  s = reduce(fixture, s, { type: "advance" });
  assert.equal(s.phase, "ending");
  assert.equal(s.endingTitle, "좋은 끝");
});

test("없는 씬을 가리키면 던지지 않고 error 에 남는다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipScene" });
  s = reduce(fixture, s, { type: "choose", index: 1 });
  s = reduce(fixture, s, { type: "advance" });
  assert.equal(s.phase, "scene");
  assert.match(s.error ?? "", /missing-scene/);
});

test("없는 선택지 인덱스도 던지지 않는다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipScene" });
  const next = reduce(fixture, s, { type: "choose", index: 9 });
  assert.match(next.error ?? "", /선택지/);
});

test("restore 는 저장된 위치로 복원한다", () => {
  const s = reduce(fixture, initialState(fixture), { type: "restore", sceneId: "a", lineIndex: 1, affection: 3 });
  assert.equal(s.sceneId, "a");
  assert.equal(s.lineIndex, 1);
  assert.equal(s.affection, 3);
});

test("씬이 바뀔 때 sceneEpoch 이 증가한다", () => {
  const start = reduce(fixture, initialState(fixture), { type: "start" });
  const jumped = reduce(fixture, reduce(fixture, start, { type: "skipScene" }), { type: "choose", index: 0 });
  assert.ok(jumped.sceneEpoch > start.sceneEpoch);
});

test("말하는 인물의 표정은 줄 단위로 덮어쓴다", () => {
  const scene = fixture.scenes[0];
  assert.ok(scene);
  assert.equal(spritesAt(scene, 0)[0]?.expression, "neutral");
  assert.equal(spritesAt(scene, 1)[0]?.expression, "smile");
});
