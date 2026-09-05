/**
 * 런북 문서가 도구의 실제 동작과 어긋나지 않는지 검사한다.
 *
 * 문서는 사람이 읽고 손으로 고치므로 코드보다 먼저 낡는다. 여기서는 문장을
 * 그대로 박제하지 않고, 문서가 주장하는 "기계가 확인할 수 있는 값"만 뽑아
 * 도구에 물어본다. 표현을 다듬는 것은 자유롭게 두고 사실이 틀어질 때만 깨진다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FALLBACK_RULES, analyzeUserText, diagnose, parseRules } from "./momus-gate-doctor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "contract", "momus-gate.md");
const doc = readFileSync(DOC, "utf8");

const FIXTURE = join(ROOT, "tools", "fixtures", "omo-task-rules.fixture.js");
const rules = parseRules(FIXTURE);

/** 문서 표에서 `| \`발화\` | 열림/안 열림 |` 행을 뽑는다. */
function docVerdicts() {
  const rows = [];
  for (const m of doc.matchAll(/^\|\s*`([^`]+)`\s*\|\s*\*{0,2}(열림|안 열림)\*{0,2}\s*\|/gm)) {
    rows.push({ text: m[1], expected: m[2] === "열림" });
  }
  return rows;
}

test("문서가 예로 든 발화의 판정이 도구와 일치한다", () => {
  const rows = docVerdicts();
  assert.ok(rows.length >= 5, `문서에서 발화 예시를 찾지 못했다 (${rows.length}건)`);
  for (const { text, expected } of rows) {
    assert.equal(analyzeUserText(text, rules).planRequested, expected, `문서: ${text}`);
  }
});

test("문서가 적은 게이트 조건 이름이 실제 규칙과 같다", () => {
  const gate = rules.gates.momus;
  assert.deepEqual(gate.requiresSkills, ["ulw-plan"]);
  assert.deepEqual(gate.forbidsSkills, ["ulw-execute"]);
  assert.equal(gate.requiresPlanArtifact, true);
  for (const token of ["hasUserRequested", "hasPlanArtifact", "forbidsSkills"]) {
    assert.ok(doc.includes(token), `문서에 ${token} 설명이 없다`);
  }
  for (const skill of [...gate.requiresSkills, ...gate.forbidsSkills]) {
    assert.ok(doc.includes(skill), `문서에 ${skill} 언급이 없다`);
  }
});

test("문서에 적힌 정규식이 실제 규칙에 존재한다", () => {
  const quoted = [...doc.matchAll(/^\/(.+)\/$/gm)].map((m) => `/${m[1]}/`);
  assert.ok(quoted.length >= 2, "문서에서 정규식 블록을 찾지 못했다");
  const actual = new Set(rules.natural.map((re) => re.source));
  for (const q of quoted) {
    const body = q.slice(1, -1);
    assert.ok(actual.has(body), `문서의 정규식이 실제 규칙에 없다: ${q}`);
  }
});

test("문서가 약속한 종료 코드와 상태 이름이 도구와 같다", () => {
  const d = diagnose({ root: join(ROOT, "tools", "fixtures") });
  // 문서는 통과를 단정하지 않는다고 적었다. 실제로도 그런 상태가 없어야 한다.
  assert.ok(doc.includes("확실히 막힘") && doc.includes("세션상태(확인불가)"));
  for (const c of d.conditions) assert.ok(["blocked", "unknown"].includes(c.state));
  assert.ok(doc.includes("종료 코드는 **0**"), "문서에 종료 코드 약속이 없다");
});

test("문서가 경고한 금지 스킬 태그가 실제로 경고를 낸다", () => {
  const d = diagnose({ texts: ['<skill name="ulw-execute">계획을 먼저 세워줘</skill>'] });
  assert.deepEqual(d.textChecks[0].forbiddenInvoked, ["ulw-execute"]);
  assert.equal(d.textChecks[0].planRequested, false);
  assert.ok(doc.includes("금지 스킬"), "문서에 금지 스킬 경고 설명이 없다");
});

test("문서가 나열한 제거 블록이 실제 제거 규칙과 개수가 같다", () => {
  const listed = ["<ultrawork-mode>", "<system-reminder>", '<skill name="'];
  for (const tag of listed) assert.ok(doc.includes(tag), `문서에 ${tag} 설명이 없다`);
  // ultrawork/reminder 2개 + skill 블록 2개
  assert.equal(rules.strip.length, 4);
  assert.equal(FALLBACK_RULES.strip.length, rules.strip.length);
  assert.equal(analyzeUserText("<system-reminder>계획을 먼저 세워줘</system-reminder>", rules).planRequested, false);
});
