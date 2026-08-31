import assert from "node:assert/strict";
import { test } from "node:test";
import { reduce } from "../src/engine/reducer.js";
import { initialState } from "../src/engine/types.js";
import { helloScript, scriptFromNode } from "../src/helloScript.js";
import { helloNode } from "@vnmaker/ir";

test("빈 대사는 거절한다", () => {
  assert.throws(() => helloScript("   "), /빈 대사/);
});

test("한 줄을 넘기면 엔딩으로 간다", () => {
  const script = helloScript("  은행나무 그늘 아래로 종강 바람이 스친다.  ");
  assert.equal(script.scenes[0]?.lines[0]?.text, "은행나무 그늘 아래로 종강 바람이 스친다.");
  let state = reduce(script, initialState(script), { type: "start" });
  assert.equal(state.phase, "scene");
  assert.equal(state.sceneId, "hello");
  state = reduce(script, state, { type: "advance" });
  assert.equal(state.phase, "ending");
  assert.equal(state.endingTitle, "그 한 줄");
});

test("디스크 노드를 PLAY 로 컴파일한다", () => {
  const compiled = scriptFromNode(helloNode("바람이 차갑다."));
  assert.equal(compiled.scenes[0]?.lines[0]?.text, "바람이 차갑다.");
});
