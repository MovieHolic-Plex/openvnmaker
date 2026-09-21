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
