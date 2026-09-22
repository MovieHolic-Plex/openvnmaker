/**
 * 연출 신기능 — 입자·틴트 셀렉터, 인라인 마크업, 독자 입력 줄.
 *
 * 잡는 결함:
 * - effectAt/tintAt 이 줄 순서를 누적해야 한다 — undefined=유지, null=끄기, 값=전환.
 *   조건(when)으로 숨겨진 줄의 큐는 절대 적용되면 안 된다.
 * - 인라인 마크업은 타자기 전에 풀어야 한다 — 태그가 반쯤 타이핑되면 안 된다.
 *   모르는 {토큰}·닫히지 않은 별표는 그대로 보여야 한다(원고 오타가 데이터를 삼키면 안 된다).
 * - input 줄은 advance·스킵 모두에서 멈춰야 한다 — 입력 없이 넘어가면 {flag:player} 가 빈 채로 풀린다.
 * - 스토어 outfit: 역할은 의상 원화로 계획돼야 한다 — 기본 표정표에 섞이면 의상이 잡히지 않는다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Line, Scene, VnScript } from "@vnmaker/content";
import { reduce } from "../src/engine/reducer.js";
import { initialState } from "../src/engine/types.js";
import { effectAt, tintAt } from "../src/engine/selectors.js";
import { resolveInline, resolveText, truncateParts } from "../src/engine/inlineText.js";
import { installPlan, type StoreManifest } from "../src/studio/storeInstall.js";

// ---------- 입자·틴트 셀렉터 ----------

const effectScene: Scene = {
  id: "s", background: "title",
  effect: "rain",
  tint: "midnight",
  lines: [
    { speaker: null, text: "비가 온다" },                                  // 0 rain / midnight
    { speaker: null, text: "눈으로", effect: "snow" },                    // 1 snow / midnight
    { speaker: null, text: "계속 눈" },                                   // 2 snow 유지
    { speaker: null, text: "입자 종료", effect: null, tint: null },       // 3 없음
    { speaker: null, text: "숨겨진 줄", effect: "embers", when: { all: ["never"] } }, // 4 미적용
    { speaker: null, text: "아무것도 안 뜸" },                             // 5 그대로 없음
  ],
};

test("effectAt: 씬 기본값을 이어받고 줄 큐로 전환·해제되며 숨겨진 줄은 건너뛴다", () => {
  assert.equal(effectAt(effectScene, 0), "rain");
  assert.equal(effectAt(effectScene, 1), "snow");
  assert.equal(effectAt(effectScene, 2), "snow");
  assert.equal(effectAt(effectScene, 3), null);
  assert.equal(effectAt(effectScene, 5), null, "조건 불충족 줄의 embers 큐가 새면 안 된다");
});

test("tintAt: 씬 틴트를 물려받고 null 큐가 걷는다", () => {
  assert.equal(tintAt(effectScene, 2), "midnight");
  assert.equal(tintAt(effectScene, 3), null);
  const lineTint: Scene = { id: "s2", background: "title", lines: [
    { speaker: null, text: "a" },
    { speaker: null, text: "b", tint: "crisis" },
    { speaker: null, text: "c" },
  ] };
  assert.equal(tintAt(lineTint, 0), null);
  assert.equal(tintAt(lineTint, 1), "crisis");
  assert.equal(tintAt(lineTint, 2), "crisis");
});

// ---------- 인라인 마크업 ----------

test("resolveInline: 굵게·기울임·색을 파트로 분해하고 평문은 태그 없이 나온다", () => {
  const r = resolveInline("그는 **대답**했고 *천천히* {c:#ff5566}사라졌{/c}다.");
  assert.equal(r.plain, "그는 대답했고 천천히 사라졌다.");
  const bold = r.parts.find(p => p.text === "대답");
  const italic = r.parts.find(p => p.text === "천천히");
  const colored = r.parts.find(p => p.text === "사라졌");
  assert.equal(bold?.bold, true);
  assert.equal(italic?.italic, true);
  assert.equal(colored?.color, "#ff5566");
  assert.equal(r.parts.find(p => p.text === "다.")?.color, undefined);
});

test("resolveInline: {flag:name}·{player} 치환 — 없는 플래그는 빈 문자열", () => {
  const r = resolveInline("{player}, {flag:place}에 왔구나.", { player: "연우", place: "미술관" });
  assert.equal(r.plain, "연우, 미술관에 왔구나.");
  assert.equal(resolveInline("{flag:missing}", {}).plain, "");
});

test("resolveInline: 치환값 안의 마크업 문자는 태그가 아니라 글자다", () => {
  // 플래그 값에 ** 가 들어가도 재파싱하지 않는다 — 독자 입력이 문법을 깨면 안 된다.
  const r = resolveInline("이름은 {player}.", { player: "별**이" });
  assert.equal(r.plain, "이름은 별**이.");
  assert.ok(r.parts.every(p => !p.bold));
});

test("resolveInline: 닫히지 않은 별표·모르는 토큰·무효 색 태그는 원문 그대로", () => {
  assert.equal(resolveInline("가격은 *별표 하나", {}).plain, "가격은 *별표 하나");
  assert.equal(resolveInline("{날씨}라니", {}).plain, "{날씨}라니");
  assert.equal(resolveInline("{c:red}잘못된 색{/c}", {}).plain, "{c:red}잘못된 색{/c}", "무효 {c:red} 때문에 {/c} 꼬리가 삼켜지면 안 된다");
});

test("truncateParts: 타이핑 중간에서 잘라도 태그는 나오지 않는다", () => {
  const r = resolveInline("앞**뒤**끝");
  assert.equal(r.plain, "앞뒤끝");
  const cut = truncateParts(r.parts, 2);
  assert.equal(cut.map(p => p.text).join(""), "앞뒤");
  assert.equal(cut[1]?.bold, true, "잘린 파트도 스타일을 유지해야 한다");
});

test("resolveText: 화자 이름·선택지 문구용 평문 치환", () => {
  assert.equal(resolveText("{player}", { player: "하늘" }), "하늘");
  assert.equal(resolveText("**강조** 없음", {}), "강조 없음");
});

// ---------- 독자 입력 줄 ----------

const inputScript: VnScript = {
  title: "입력", start: "s",
  characters: [],
  scenes: [{
    id: "s", background: "title",
    lines: [
      { speaker: null, text: "이름을 묻는다", input: { flag: "player", prompt: "이름?", max: 4 } },
      { speaker: null, text: "{player} 님이군요" },
    ],
    next: "end",
  }, { id: "end", background: "title", lines: [{ speaker: null, text: "끝" }], ending: "끝" }],
};

test("input 줄은 advance 로 넘어가지 않고 input 액션만 통과시킨다", () => {
  let state = initialState(inputScript);
  state = reduce(inputScript, state, { type: "start" });
  assert.equal(state.lineIndex, 0);
  const stuck = reduce(inputScript, state, { type: "advance" });
  assert.equal(stuck.lineIndex, 0, "입력 없이는 진행하면 안 된다");
  state = reduce(inputScript, state, { type: "input", flag: "player", value: "연우" });
  assert.equal(state.flags["player"], "연우");
  assert.equal(state.lineIndex, 1);
  // 다른 플래그 이름으로 온 입력은 현재 줄과 무관하면 무시한다.
  const wrong = reduce(inputScript, initialState(inputScript), { type: "start" });
  assert.equal(reduce(inputScript, wrong, { type: "input", flag: "other", value: "x" }).lineIndex, 0);
});

test("input 값은 max 길이로 잘리고 공백만 오면 거부한다", () => {
  let state = reduce(inputScript, initialState(inputScript), { type: "start" });
  const tooLong = reduce(inputScript, state, { type: "input", flag: "player", value: "가나다라마바사" });
  assert.equal(tooLong.flags["player"], "가나다라");
  state = reduce(inputScript, state, { type: "input", flag: "player", value: "   " });
  assert.equal(state.flags["player"], undefined);
});

test("스킵은 input 줄 앞에서 멈춘다", () => {
  const script: VnScript = {
    title: "t", start: "s", characters: [],
    scenes: [{ id: "s", background: "title", lines: [
      { speaker: null, text: "1" },
      { speaker: null, text: "2" },
      { speaker: null, text: "묻는다", input: { flag: "player" } },
      { speaker: null, text: "4" },
    ] }],
  };
  let state = reduce(script, initialState(script), { type: "start" });
  state = reduce(script, state, { type: "skipToChoice" });
  assert.equal(state.lineIndex, 2, "input 줄(2번)에서 멈춰야 한다");
});

// ---------- 스토어 의상 역할 ----------

const castManifest: StoreManifest = {
  spec: "losia-asset/1", id: "ch-outfit", kind: "character", name: "해린",
  license: "downloadable",
  uploader: { handle: "losia", display: "Losia" },
  files: [
    { role: "base", url: "https://losia.online/api/assets/ch-outfit/files/base" },
    { role: "expression:미소", url: "https://losia.online/api/assets/ch-outfit/files/expression%3A미소" },
    { role: "outfit:uniform:base", url: "https://losia.online/api/assets/ch-outfit/files/outfit%3Auniform%3Abase" },
    { role: "outfit:uniform:expression:미소", url: "https://losia.online/api/assets/ch-outfit/files/outfit%3Auniform%3Aexpression%3A미소" },
    { role: "outfit:uniform:pose:상반신", url: "https://losia.online/api/assets/ch-outfit/files/outfit%3Auniform%3Apose%3A상반신" },
    { role: "outfit:uniform:나머지", url: "https://losia.online/api/assets/ch-outfit/files/x" },
  ],
};

test("outfit: 역할은 의상 원화로 계획되고 기본 표정표와 섞이지 않는다", () => {
  const plan = installPlan(castManifest);
  const outfits = plan.files.filter(f => f.outfit === "uniform");
  assert.equal(outfits.length, 3, "outfit:uniform:base·expression·pose 3건");
  const outfitBase = outfits.find(f => f.role === "outfit:uniform:base");
  assert.equal(outfitBase?.expression, "neutral", "의상 base 는 그 의상의 neutral 로 선다");
  const outfitSmile = outfits.find(f => f.role === "outfit:uniform:expression:미소");
  assert.equal(outfitSmile?.expression, "smile");
  const plain = plan.files.filter(f => !f.outfit);
  assert.equal(plain.length, 2, "base·expression:미소만 기본 표정표로");
  assert.deepEqual(plan.ignored, ["outfit:uniform:나머지"]);
});

// ---------- 회귀: 적대적 리뷰 수정분 ----------

test("스킵은 input 줄에 서 있을 때도 멈춘다 — 플래그 없이 지나치면 선택지가 전부 닫힌다", () => {
  const script: VnScript = {
    title: "t", start: "s", characters: [],
    scenes: [
      { id: "s", background: "title", lines: [
        { speaker: null, text: "묻는다", input: { flag: "player" } },
        { speaker: null, text: "뒤" },
      ], choices: [{ text: "간다", next: "e", when: { all: ["player"] } }] },
      { id: "e", background: "title", lines: [{ speaker: null, text: "끝" }], ending: "끝" },
    ],
  };
  let state = reduce(script, initialState(script), { type: "start" });
  assert.equal(state.lineIndex, 0);
  const skipped = reduce(script, state, { type: "skipToChoice" });
  assert.equal(skipped.lineIndex, 0, "input 줄에 서 있는 동안 스킵은 넘어가면 안 된다");
  assert.equal(skipped.error ?? null, null);
});

test("input 정규 숫자 문자열은 숫자 플래그로 저장되고 비정규 표기는 문자열을 유지한다", () => {
  const script: VnScript = {
    title: "t", start: "s", characters: [],
    scenes: [{ id: "s", background: "title", lines: [
      { speaker: null, text: "나이?", input: { flag: "age" } },
      { speaker: null, text: "끝" },
    ] }],
  };
  let state = reduce(script, initialState(script), { type: "start" });
  state = reduce(script, state, { type: "input", flag: "age", value: "25" });
  assert.equal(state.flags["age"], 25, "compare:{gte:20} 가 숫자를 요구하므로 숫자로 저장");
  const rest = reduce(script, initialState(script), { type: "start" });
  const leading = reduce(script, rest, { type: "input", flag: "age", value: "007" });
  assert.equal(leading.flags["age"], "007", "비정규 표기는 문자열 유지");
});

test("복원은 입력으로 모은 플래그를 씬 진입 set 으로 덮어쓰지 않는다", () => {
  const script: VnScript = {
    title: "t", start: "s", characters: [],
    scenes: [{ id: "s", background: "title", set: { player: "기본이름" }, lines: [
      { speaker: null, text: "이름?", input: { flag: "player" } },
      { speaker: null, text: "{player} 님" },
      { speaker: null, text: "셋" },
    ] }],
  };
  let state = reduce(script, initialState(script), { type: "start" });
  assert.equal(state.flags["player"], "기본이름", "진입 set 이 먼저 돈다");
  state = reduce(script, state, { type: "input", flag: "player", value: "연우" });
  state = reduce(script, state, { type: "advance" });
  const restored = reduce(script, initialState(script), { type: "restore", sceneId: "s", lineIndex: 2, affection: 0, flags: state.flags });
  assert.equal(restored.flags["player"], "연우", "저장된 입력값이 set 기본값보다 우선해야 한다");
});

test("감사는 input 줄이 쓰는 플래그를 씬 출구에서 세팅된 것으로 본다", async () => {
  const { auditScript } = await import("@vnmaker/content");
  const script: VnScript = {
    title: "t", start: "s", characters: [],
    scenes: [
      { id: "s", background: "title", lines: [
        { speaker: null, text: "이름?", input: { flag: "player" } },
      ], choices: [
        { text: "간다", next: "e", when: { all: ["player"] } },
        { text: "안 간다", next: "e" },
      ] },
      { id: "e", background: "title", lines: [{ speaker: null, text: "끝" }], ending: "끝" },
    ],
  };
  const errors = auditScript(script).filter(issue => issue.severity === "error");
  assert.deepEqual(errors.map(issue => issue.message), [], `거짓 데드엔드 진단이 없어야 한다: ${errors.map(i => i.message).join(" / ")}`);
});

test("유효하지 않은 의상 id 와 빈 의상 id 는 설치 대상에서 빠진다", () => {
  const manifest: StoreManifest = {
    spec: "losia-asset/1", id: "evil", kind: "character", name: "악성",
    license: "downloadable", uploader: { handle: "x", display: "x" },
    files: [
      { role: "base", url: "https://losia.online/api/assets/evil/files/base" },
      { role: "outfit:__proto__:base", url: "https://losia.online/api/assets/evil/files/a" },
      { role: "outfit:constructor:expression:미소", url: "https://losia.online/api/assets/evil/files/b" },
      { role: "outfit::expression:미소", url: "https://losia.online/api/assets/evil/files/c" },
      { role: "outfit:uniform:base", url: "https://losia.online/api/assets/evil/files/d" },
    ],
  };
  const plan = installPlan(manifest);
  assert.deepEqual(plan.files.filter(f => f.outfit !== undefined).map(f => f.outfit), ["uniform"]);
  assert.deepEqual(plan.ignored, ["outfit:__proto__:base", "outfit:constructor:expression:미소", "outfit::expression:미소"]);
  assert.ok(plan.files.some(f => f.outfit === "uniform"));
});

test("같은 role 슬러그가 두 번 오면 두 번째는 무시한다 — artwork id 충돌 방지", () => {
  const manifest: StoreManifest = {
    spec: "losia-asset/1", id: "dup", kind: "stage", name: "중복",
    license: "downloadable", uploader: { handle: "x", display: "x" },
    files: [
      { role: "base", url: "https://losia.online/api/assets/dup/files/1" },
      { role: "base", url: "https://losia.online/api/assets/dup/files/2" },
      { role: "variant:낮", url: "https://losia.online/api/assets/dup/files/3" },
    ],
  };
  const plan = installPlan(manifest);
  assert.equal(plan.files.filter(f => f.role === "base").length, 1);
  assert.deepEqual(plan.ignored, ["base"]);
});

test("expressionKey 는 프로토타입 멤버를 별칭으로 읽지 않는다", async () => {
  const { expressionKey } = await import("../src/studio/storeInstall.js");
  for (const label of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    const key = expressionKey(label);
    assert.equal(typeof key, "string", `${label} 은 문자열 키여야 한다`);
    assert.ok(!["function", "object"].includes(typeof key));
  }
  assert.equal(expressionKey("미소"), "smile", "정상 별칭은 그대로");
});

test("{flag:} 치환은 프로토타입 멤버를 빈 문자열로 둔다", () => {
  for (const name of ["constructor", "toString", "valueOf"]) {
    const resolved = resolveInline(`{flag:${name}}`, {});
    assert.equal(resolved.plain, "", `{flag:${name}} 는 빈 문자열이어야 한다`);
  }
  // "__proto__" 는 플래그명 규칙(영문 시작)에 안 맞아 토큰 자체가 성립하지 않는다 — 리터럴로 남긴다.
  assert.equal(resolveInline("{flag:__proto__}", {}).plain, "{flag:__proto__}");
  assert.equal(resolveInline("{player}", {}).plain, "");
  assert.equal(resolveInline("{player}", { player: "연우" }).plain, "연우");
});

test("rememberRead 는 프로토타입과 겹치는 씬 id 에도 죽지 않는다", async () => {
  const { rememberRead } = await import("../src/storage/persist.js");
  assert.doesNotThrow(() => rememberRead(["constructor#0", "toString#1", "__proto__#2", "hasOwnProperty#0"]));
});

test("Ren'Py보내기는 input 줄을 renpy.input 으로 내고 인라인 마크업을 살린다", async () => {
  const { generateRenpyScript } = await import("../src/studio/renpyScript.js");
  const script: VnScript = {
    title: "t", subtitle: "d", start: "s", characters: [],
    scenes: [
      { id: "s", background: "title", lines: [
        { speaker: null, text: "이름?", input: { flag: "player", prompt: "이름을 알려줘", max: 12 } },
        { speaker: null, text: "{player}, **정말** {c:#a78bfa}반가워{/c}." },
      ], next: "e" },
      { id: "e", background: "title", lines: [{ speaker: null, text: "끝" }], ending: "끝" },
    ],
  };
  const out = generateRenpyScript(script);
  assert.match(out, /renpy\.input\("이름을 알려줘", length=12\)/);
  assert.match(out, /vn_store_input\("player", vn_in, 12\)/);
  assert.match(out, /\[vn_flags\.get\("player",""\)\]/);
  assert.match(out, /\{b\}정말\{\/b\}/);
  assert.match(out, /\{color=#a78bfa\}반가워\{\/color\}/);
});

test("Ren'Py보내기는 지원하지 않는 연출 큐를 파일 상단 경고로 남긴다", async () => {
  const { generateRenpyScript } = await import("../src/studio/renpyScript.js");
  const script: VnScript = {
    title: "t", subtitle: "d", start: "s", characters: [],
    scenes: [
      { id: "s", background: "title", effect: "rain", next: "e", lines: [{ speaker: null, text: "비", tint: "#334455" }] },
      { id: "e", background: "title", lines: [{ speaker: null, text: "끝" }], ending: "끝" },
    ],
  };
  const out = generateRenpyScript(script);
  assert.match(out, /# WARNING: effect\/tint cues are not supported/);
  assert.match(out, /scenes: s\)/);
});

// ---------- 회귀: 2차 적대적 리뷰 (엔진) ----------

test("복원이 다른 씬으로 체인하면 요청한 씬의 엔딩·phase 를 억지로 입히지 않는다", () => {
  // 저장 시점의 플래그로는 씬 a 의 모든 줄이 가려져 enterScene 이 b 로 체인한다.
  // 꼬리 로직이 a 의 exits/ending 을 b 상태에 다시 적용하면 안 된다.
  const script: VnScript = {
    title: "t", start: "a", characters: [],
    scenes: [
      { id: "a", background: "title", lines: [
        { speaker: null, text: "가려짐", when: { all: ["never"] } },
      ], routes: [{ next: "b", when: { none: ["bx"] } }], ending: "a엔딩" },
      { id: "b", background: "title", set: { bx: true }, lines: [{ speaker: null, text: "비" }], ending: "b엔딩" },
    ],
  };
  const restored = reduce(script, initialState(script), { type: "restore", sceneId: "a", lineIndex: 0, affection: 0, flags: {}, phase: "ending" });
  assert.equal(restored.sceneId, "b", "체인 도착지는 b");
  assert.notEqual(restored.phase, "ending", "요청한 a 의 엔딩이 b 에 억지로 입혀지면 안 된다");
  assert.notEqual(restored.endingTitle, "a엔딩");
  assert.equal(restored.error ?? null, null);
});

test("읽은 줄 키는 숫자 id 와 인덱스를 구분한다 — id:'3' 과 위치 3 이 다른 키다", async () => {
  const { readKey } = await import("../src/engine/types.js");
  const byId = readKey("a", 0, { id: "3" });
  const byIndex = readKey("a", 3, undefined);
  assert.notEqual(byId, byIndex, `충돌하면 안 된다: ${byId} vs ${byIndex}`);
});

test("감사는 when 붙은 input 플래그가 안 세팅되는 경로도 탐색한다", async () => {
  const { auditScript } = await import("@vnmaker/content");
  const script: VnScript = {
    title: "t", start: "s", characters: [],
    scenes: [
      { id: "s", background: "title", lines: [
        { speaker: null, text: "보임" },
        { speaker: null, text: "조건 입력", input: { flag: "x" }, when: { all: ["nope"] } },
      ], routes: [{ next: "b", when: { all: ["x"] } }] },
      { id: "b", background: "title", lines: [{ speaker: null, text: "끝" }], ending: "끝" },
    ],
  };
  const issues = auditScript(script);
  assert.ok(issues.some(issue => issue.sceneId === "s" && issue.message.includes("갈 곳이 없")), `조건 input 미작성 경로의 데드엔드를 잡아야 한다: ${JSON.stringify(issues)}`);
});

test("input 은 trim 후 코드포인트 단위로 자른다 — 이모지가 쪼개지지 않는다", () => {
  const script: VnScript = {
    title: "t", start: "s", characters: [],
    scenes: [{ id: "s", background: "title", lines: [
      { speaker: null, text: "?", input: { flag: "face", max: 1 } },
      { speaker: null, text: "끝" },
    ] }],
  };
  let state = reduce(script, initialState(script), { type: "start" });
  state = reduce(script, state, { type: "input", flag: "face", value: "😀x" });
  assert.equal(state.flags["face"], "😀", "서로게이트 쌍이 반으로 쪼개지면 안 된다");
});

test("truncateParts: 서로게이트 쌍 경계에서 자르면 상위 서로게이트를 버린다", () => {
  const r = resolveInline("hi {flag:name}!", { name: "A😀B" });
  assert.equal(r.plain.length, 8); // 😀 = 2 코드 유닛
  assert.equal(truncateParts(r.parts, 5).map(p => p.text).join(""), "hi A", "쌍을 쪼개지 않는다");
  assert.equal(truncateParts(r.parts, 6).map(p => p.text).join(""), "hi A😀");
});
