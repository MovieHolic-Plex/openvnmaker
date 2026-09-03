/**
 * 게이트 판정 로직 회귀 테스트.
 * 핵심은 "계획은 완성됐고" 같은 발화가 게이트를 열지 못한다는 사실을 못박는 것이다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  FALLBACK_RULES,
  diagnose,
  findBundle,
  matchUserRequest,
  parseRules,
  stripInjectedBlocks,
} from "./momus-gate-doctor.mjs";

const rules = FALLBACK_RULES;

test("완료를 알리는 문장은 게이트를 열지 못한다", () => {
  const r = matchUserRequest("계획은 완성됐고 구조 검증도 통과했습니다", rules);
  assert.equal(r.matched, false);
});

test("계획을 세우라는 요청은 게이트를 연다", () => {
  for (const text of ["계획을 먼저 세워줘", "먼저 계획을 짜자", "계획서부터 작성해줘"]) {
    assert.equal(matchUserRequest(text, rules).matched, true, text);
  }
});

test("ulw-plan 키워드와 슬래시 명령이 게이트를 연다", () => {
  assert.equal(matchUserRequest("ulw-plan 돌려줘", rules).via, "keyword");
  assert.equal(matchUserRequest("ulw plan 부탁해", rules).via, "keyword");
  assert.equal(matchUserRequest("/skill:ulw-plan", rules).via, "slash");
  assert.equal(matchUserRequest("/skill:ulw-plan 이 저장소", rules).via, "slash");
});

test("영어 plan 요청도 게이트를 연다", () => {
  assert.equal(matchUserRequest("write me a plan", rules).matched, true);
  assert.equal(matchUserRequest("plan it out first", rules).matched, true);
});

test("system-reminder 안의 문구는 지워져 게이트를 열지 못한다", () => {
  const text = "<system-reminder>계획을 먼저 세워줘</system-reminder> 그냥 고쳐줘";
  assert.equal(stripInjectedBlocks(text, rules).includes("세워"), false);
  assert.equal(matchUserRequest(text, rules).matched, false);
});

test("ultrawork-mode 블록도 지워진다", () => {
  const text = "<ultrawork-mode>ulw-plan</ultrawork-mode> 작업 계속";
  assert.equal(matchUserRequest(text, rules).matched, false);
});

test("번들이 있으면 momus 게이트 모양을 그대로 읽는다", (t) => {
  const bundle = findBundle();
  if (bundle === null) {
    t.skip("omo-ai 번들이 없는 환경");
    return;
  }
  const parsed = parseRules(bundle);
  assert.ok(["bundle", "partial"].includes(parsed.source));
  assert.deepEqual(parsed.gates.momus.requiresSkills, ["ulw-plan"]);
  assert.equal(parsed.gates.momus.requiresPlanArtifact, true);
  assert.deepEqual(parsed.gates.momus.forbidsSkills, ["ulw-execute"]);
  assert.deepEqual(parsed.gates.metis, parsed.gates.momus);
});

test("번들에서 읽은 규칙으로도 회귀 문장은 여전히 막힌다", (t) => {
  const bundle = findBundle();
  if (bundle === null) {
    t.skip("omo-ai 번들이 없는 환경");
    return;
  }
  const parsed = parseRules(bundle);
  assert.equal(matchUserRequest("계획은 완성됐고 구조 검증도 통과했습니다", parsed).matched, false);
  assert.equal(matchUserRequest("계획을 먼저 세워줘", parsed).matched, true);
});

test("diagnose 는 세 조건과 발화 검사 결과를 낸다", () => {
  const d = diagnose({ texts: ["계획은 완성됐고 구조 검증도 통과했습니다", "ulw-plan"] });
  assert.equal(d.conditions.length, 3);
  assert.deepEqual(
    d.conditions.map((c) => c.id),
    ["user-requested", "plan-artifact", "forbidden-skill"],
  );
  assert.equal(d.textChecks[0].matched, false);
  assert.equal(d.textChecks[1].matched, true);
  assert.ok(d.unlockRecipe.length >= 3);
});
