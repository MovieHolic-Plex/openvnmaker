/**
 * 게이트 판정 로직 회귀 테스트.
 *
 * 핵심은 두 가지다. "계획은 완성됐고" 같은 발화가 게이트를 열지 못한다는 것과,
 * 스킬 태그가 든 발화를 번들과 똑같이 해석한다는 것. 후자는 커밋된 픽스처로
 * 검사하므로 omo 가 깔리지 않은 CI 에서도 그대로 돈다.
 */
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FALLBACK_RULES,
  analyzeUserText,
  diagnose,
  findBundle,
  parseRules,
  stripInjectedBlocks,
} from "./momus-gate-doctor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "omo-task-rules.fixture.js");

/** 픽스처에서 읽은 규칙. 번들이 없어도 항상 존재한다. */
const fixtureRules = parseRules(FIXTURE);

test("픽스처만으로 모든 규칙이 파싱된다", () => {
  assert.equal(fixtureRules.source, "bundle", fixtureRules.reason ?? "");
  assert.equal(fixtureRules.natural.length, 6);
  assert.equal(fixtureRules.strip.length, 4);
  assert.deepEqual(fixtureRules.gates.momus, {
    requiresSkills: ["ulw-plan"],
    requiresPlanArtifact: true,
    forbidsSkills: ["ulw-execute"],
  });
  assert.deepEqual(fixtureRules.gates.metis, fixtureRules.gates.momus);
  assert.equal(Object.keys(fixtureRules.gates).length, 2);
});

for (const [label, rules] of [
  ["fallback", FALLBACK_RULES],
  ["픽스처", fixtureRules],
]) {
  test(`${label}: 완료를 알리는 문장은 게이트를 열지 못한다`, () => {
    assert.equal(analyzeUserText("계획은 완성됐고 구조 검증도 통과했습니다", rules).planRequested, false);
  });

  test(`${label}: 계획을 세우라는 요청은 게이트를 연다`, () => {
    for (const text of ["계획을 먼저 세워줘", "먼저 계획을 짜자", "계획서부터 작성해줘"]) {
      assert.equal(analyzeUserText(text, rules).planRequested, true, text);
    }
  });

  test(`${label}: 키워드와 슬래시 명령이 게이트를 연다`, () => {
    assert.equal(analyzeUserText("ulw-plan 돌려줘", rules).via, "keyword");
    assert.equal(analyzeUserText("ulw plan 부탁해", rules).via, "keyword");
    assert.equal(analyzeUserText("/skill:ulw-plan", rules).via, "slash");
    assert.equal(analyzeUserText("/skill:ulw-plan 이 저장소", rules).via, "slash");
  });

  test(`${label}: 영어 plan 요청도 게이트를 연다`, () => {
    assert.equal(analyzeUserText("write me a plan", rules).planRequested, true);
    assert.equal(analyzeUserText("plan it out first", rules).planRequested, true);
  });

  test(`${label}: 주입 블록 안의 문구는 지워져 게이트를 열지 못한다`, () => {
    const reminder = "<system-reminder>계획을 먼저 세워줘</system-reminder> 그냥 고쳐줘";
    assert.equal(stripInjectedBlocks(reminder, rules).includes("세워"), false);
    assert.equal(analyzeUserText(reminder, rules).planRequested, false);
    assert.equal(analyzeUserText("<ultrawork-mode>ulw-plan</ultrawork-mode> 작업 계속", rules).planRequested, false);
  });

  test(`${label}: 다른 스킬 태그로 감싼 계획 요청은 인정되지 않는다`, () => {
    // 번들은 스킬 블록을 통째로 지운 뒤 자연어를 본다. 태그 이름만 등록된다.
    const r = analyzeUserText('<skill name="contextless">계획을 먼저 세워줘</skill>', rules);
    assert.equal(r.planRequested, false);
    assert.deepEqual(r.requested, ["contextless"]);
    assert.deepEqual(r.invoked, ["contextless"]);
  });

  test(`${label}: ulw-plan 스킬 태그는 요청이자 호출로 등록된다`, () => {
    const r = analyzeUserText('<skill name="ulw-plan">뭐든</skill>', rules);
    assert.equal(r.planRequested, true);
    assert.equal(r.via, "skill-tag");
    assert.ok(r.invoked.includes("ulw-plan"));
  });

  test(`${label}: 금지 스킬 태그는 호출로 등록된다`, () => {
    const r = analyzeUserText('<skill name="ulw-execute">계획을 먼저 세워줘</skill>', rules);
    assert.deepEqual(r.invoked, ["ulw-execute"]);
    assert.equal(r.planRequested, false);
  });

  test(`${label}: 슬래시 금지 스킬은 호출로 등록되고 계획 요청이 아니다`, () => {
    const r = analyzeUserText("/skill:ulw-execute", rules);
    assert.deepEqual(r.invoked, ["ulw-execute"]);
    assert.equal(r.planRequested, false);
  });
}

test("번들이 깔려 있으면 픽스처와 같은 규칙을 읽는다", (t) => {
  const bundle = findBundle();
  if (bundle === null) {
    t.skip("omo-ai 번들이 없는 환경");
    return;
  }
  const live = parseRules(bundle);
  assert.equal(live.source, "bundle", live.reason ?? "");
  assert.deepEqual(live.gates, fixtureRules.gates);
  assert.deepEqual(live.natural.map(String), fixtureRules.natural.map(String));
  assert.deepEqual(live.strip.map(String), fixtureRules.strip.map(String));
  assert.equal(String(live.skillTag), String(fixtureRules.skillTag));
});

test("번들을 못 찾으면 fallback 이라고 밝힌다", () => {
  const r = parseRules(join(HERE, "없는파일.js"));
  assert.equal(r.source, "fallback");
  assert.equal(r.bundlePath, null);
  assert.ok(r.reason.length > 0);
});

test("diagnose 는 세 조건을 내고 통과라고 단정하지 않는다", () => {
  const d = diagnose({ texts: ["계획은 완성됐고 구조 검증도 통과했습니다", "ulw-plan"] });
  assert.deepEqual(
    d.conditions.map((c) => c.id),
    ["user-requested", "plan-artifact", "forbidden-skill"],
  );
  for (const c of d.conditions) {
    assert.ok(["blocked", "unknown"].includes(c.state), c.state);
    assert.notEqual(c.state, "pass");
  }
  assert.equal(d.textChecks[0].planRequested, false);
  assert.equal(d.textChecks[1].planRequested, true);
  assert.ok(d.unlockRecipe.length >= 3);
});

test("플랜 파일이 없으면 그 조건만 확실히 막혔다고 말한다", () => {
  const empty = resolve(HERE, "fixtures");
  const d = diagnose({ root: empty });
  const artifact = d.conditions.find((c) => c.id === "plan-artifact");
  assert.equal(artifact.state, "blocked");
  assert.deepEqual(artifact.files, []);
});

test("금지 스킬 호출은 발화 검사에 경고로 드러난다", () => {
  const d = diagnose({ texts: ["/skill:ulw-execute"] });
  assert.deepEqual(d.textChecks[0].forbiddenInvoked, ["ulw-execute"]);
});
