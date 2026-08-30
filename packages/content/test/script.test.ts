import assert from "node:assert/strict";
import { test } from "node:test";
import { script } from "../src/index.js";
import {
  countKoreanChars,
  findBrokenSceneRefs,
  findForbiddenTokens,
  findManifestViolations,
} from "../src/check.js";

test("분량: 한글 9500자 이상 12000자 이하", () => {
  const count = countKoreanChars(script);
  assert.ok(count >= 9500, `한글 ${count}자 — 9500자 미달`);
  assert.ok(count <= 12000, `한글 ${count}자 — 12000자 초과`);
});

test("콘텐츠 정책: 금지 토큰이 하나도 없다", () => {
  assert.deepEqual(findForbiddenTokens(script), []);
});

test("씬 참조가 전부 존재한다", () => {
  assert.deepEqual(findBrokenSceneRefs(script), []);
});

test("에셋 id 와 인물·표정이 매니페스트를 지킨다", () => {
  assert.deepEqual(findManifestViolations(script), []);
});

test("모든 씬은 20줄 이상 48줄 이하다", () => {
  for (const scene of script.scenes) {
    assert.ok(scene.lines.length >= 20, `${scene.id}: ${scene.lines.length}줄`);
    assert.ok(scene.lines.length <= 48, `${scene.id}: ${scene.lines.length}줄`);
  }
});

test("모든 씬은 next 나 choices 나 ending 중 하나로 끝난다", () => {
  for (const scene of script.scenes) {
    const closed = scene.next !== undefined || (scene.choices?.length ?? 0) > 0 || scene.ending !== undefined;
    assert.ok(closed, `${scene.id} 가 열린 채로 끝난다`);
  }
});

test("엔딩이 정확히 3개이고 모두 다르다", () => {
  const endings = script.scenes.map((s) => s.ending).filter((e): e is string => e !== undefined);
  assert.equal(endings.length, 3);
  assert.equal(new Set(endings).size, 3);
});

test("시작 씬이 존재하고 선택지에서 세 엔딩 모두 도달 가능하다", () => {
  const byId = new Map(script.scenes.map((s) => [s.id, s]));
  assert.ok(byId.has(script.start));
  const seen = new Set<string>();
  const stack = [script.start];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const scene = byId.get(id);
    if (!scene) continue;
    if (scene.next !== undefined) stack.push(scene.next);
    for (const choice of scene.choices ?? []) stack.push(choice.next);
  }
  const reachableEndings = [...seen].map((id) => byId.get(id)?.ending).filter(Boolean);
  assert.equal(reachableEndings.length, 3);
});
