import assert from "node:assert/strict";
import { test } from "node:test";
import { script, type VnScript, type Scene } from "@vnmaker/content";
import { assembleProduction, countCharacters, createPlan, durationLabel, estimateScriptDuration, makeDraftPrompt, makeOutlinePrompt, parseDraft, parseOutline, planDraftScript, restoreProduction, scriptFingerprint, type ProductionOutline } from "../src/studio/production.js";

const base: VnScript = { title: "장편 테스트", subtitle: "", start: "first", characters: script.characters, scenes: [{ id: "first", background: "title", lines: [{ speaker: null, text: "가".repeat(320) }], ending: "끝" }] };
const scene = (id: string, minutes: number, exit: Pick<Scene, "next" | "choices" | "ending">): Scene => ({ id, background: "title", lines: [{ speaker: null, text: "가".repeat(320 * minutes) }], ...exit });
function outlineFixture(): ProductionOutline {
  return {
    title: "유리 바다의 여름", subtitle: "90분 장편 검증", bible: "졸업을 앞둔 인물들의 약속을 지키며 공통의 사실과 분기별 결과를 구분한다.", start: "scene_0",
    scenes: Array.from({ length: 19 }, (_, i) => ({ id: `scene_${i}`, chapter: `${Math.min(6, Math.floor(i / 3) + 1)}장`, title: `장면 ${i}`, summary: `${i}번째 사건에서 인물이 새로운 정보를 발견하고 자신의 선택을 결정한다.`, artDirection: "저녁빛이 비추는 캠퍼스. 창가에 붉은 리본과 접힌 편지.", targetMinutes: 5, background: "campus-gate",
      ...(i === 16 ? { choices: [{ text: "진실을 밝힌다", next: "scene_17" }, { text: "약속을 지킨다", next: "scene_18" }] } : i >= 17 ? { ending: `결말 ${i}` } : { next: `scene_${i + 1}` }),
    })),
  };
}
const draftResponse = (count = 30, size = 58) => JSON.stringify({ lines: Array.from({ length: count }, (_, index) => ({ speaker: index % 2 ? "seorin" : null, text: `${index}번째 고백. ${"서로의 마음을 이해하며 작은 약속을 떠올린다.".repeat(4).slice(0, size)}` })), summary: "서린이 숨겨온 약속을 고백했고 함께 마지막 전시를 준비하기로 했다.", continuity: ["두 사람은 전시 초대장을 함께 보관한다."] });

test("공백을 제외한 실제 대사 글자와 1회차 경로를 측정한다", () => {
  assert.equal(countCharacters("가 나\n 다\t😀"), 4);
  const story = { ...base, start: "start", scenes: [scene("start", 10, { choices: [{ text: "짧게", next: "short" }, { text: "길게", next: "long" }] }), scene("short", 5, { ending: "첫 결말" }), scene("long", 12, { next: "end" }), scene("end", 3, { ending: "둘째 결말" }), scene("unreachable", 80, { ending: "가지 않음" })] };
  const result = estimateScriptDuration(story);
  assert.equal(result.minMinutes, 15);
  assert.equal(result.maxMinutes, 25);
  assert.equal(result.endingCount, 2);
  assert.equal(result.reachableScenes, 4);
  assert.equal(durationLabel(result), "15–25분");
});

test("엔딩을 빠져나갈 수 있는 반복도 최대 시간을 유한하게 꾸미지 않는다", () => {
  const story = { ...base, scenes: [scene("first", 1, { next: "loop" }), scene("loop", 2, { choices: [{ text: "다시", next: "loop" }, { text: "끝", next: "end" }] }), scene("end", 1, { ending: "끝" })] };
  const result = estimateScriptDuration(story);
  assert.equal(result.minMinutes, 4);
  assert.equal(result.maxMinutes, null);
  assert.equal(result.hasCycle, true);
  assert.equal(durationLabel(result), "4분 이상");
});

test("끊긴 분기가 있으면 최대 시간과 작품 완결 여부를 알 수 없다고 보고한다", () => {
  const story = { ...base, scenes: [scene("first", 1, { choices: [{ text: "정상", next: "end" }, { text: "끊김", next: "missing" }] }), scene("end", 1, { ending: "끝" })] };
  const result = estimateScriptDuration(story);
  assert.equal(result.minMinutes, 2); assert.equal(result.maxMinutes, null); assert.equal(result.incomplete, true);
  assert.throws(() => estimateScriptDuration(base, 0), /양수/);
});

test("90분 장편 설계는 두 엔딩의 합산 95분 대신 실제 90분 경로를 검증한다", () => {
  const outline = parseOutline(outlineFixture(), 90);
  const plan = createPlan(outline, base, "90분 이야기", 90);
  const draft = planDraftScript(plan);
  assert.equal(estimateScriptDuration(draft).minMinutes, 0);
  assert.equal(estimateScriptDuration(draft).totalCharacters, 0);
  assert.equal(estimateScriptDuration(draft).incomplete, true);
  assert.throws(() => assembleProduction(plan), /모든 씬/);
  for (const beat of outline.scenes) plan.jobs[beat.id] = { status: "ready", draft: { scene: scene(beat.id, 5, { ...(beat.next ? { next: beat.next } : {}), ...(beat.choices ? { choices: beat.choices } : {}), ...(beat.ending ? { ending: beat.ending } : {}) }), summary: "사건 요약", continuity: [], model: "fixture", updatedAt: 1 } };
  const manuscript = assembleProduction(plan);
  assert.equal(manuscript.scenes.length, 19);
  assert.equal(estimateScriptDuration(manuscript).minMinutes, 90);
  assert.equal(estimateScriptDuration(manuscript).maxMinutes, 90);
  assert.equal(estimateScriptDuration(manuscript).totalCharacters, 95 * 320);
});

test("단편으로 축소한 설계·누락 링크·반복·도달 불가 씬을 거부한다", () => {
  const original = outlineFixture();
  assert.throws(() => parseOutline({ ...original, scenes: original.scenes.map(row => ({ ...row, targetMinutes: 1 })) }, 90), /목표/);
  assert.throws(() => parseOutline({ ...original, start: "missing" }, 90), /도달/);
  assert.throws(() => parseOutline({ ...original, scenes: original.scenes.map((row, index) => index === 0 ? { ...row, next: "scene_0" } : row) }, 90), /반복/);
  assert.throws(() => parseOutline({ ...original, scenes: original.scenes.slice(0, 4) }, 90), /12–80/);
});

test("장편 집필 응답은 출구를 바꾸지 못하며 짧은 원고를 완료로 세지 않는다", () => {
  const outline = parseOutline(outlineFixture(), 90);
  const plan = createPlan(outline, base, "서린과의 약속", 90);
  const beat = outline.scenes[0]!;
  const response = JSON.parse(draftResponse(12, 35));
  response["next"] = "hallucinated";
  const short = parseDraft(JSON.stringify(response), plan, beat, "fixture");
  assert.equal(short.status, "short");
  assert.equal(short.draft?.scene.next, beat.next);
  assert.equal(short.draft?.scene.artBrief, beat.artDirection);
  assert.ok(!base.scenes.some(row => row.id === beat.id));
  plan.jobs[beat.id] = short;
  const extended = parseDraft(draftResponse(30, 70), plan, beat, "fixture", true);
  assert.equal(extended.status, "ready");
  assert.equal(extended.draft?.scene.lines.length, 42);
});

test("반복 문장과 잘못된 JSON·미등록 화자를 실패로 처리한다", () => {
  const plan = createPlan(parseOutline(outlineFixture(), 90), base, "서린과의 약속", 90);
  const beat = plan.outline.scenes[0]!;
  assert.throws(() => parseDraft("oops", plan, beat, "fixture"), /JSON/);
  assert.throws(() => parseDraft(JSON.stringify({ lines: Array.from({ length: 20 }, () => ({ speaker: null, text: "이것은 같은 문장이 반복되는 테스트입니다." })), summary: "요약", continuity: [] }), plan, beat, "fixture"), /반복 대사/);
  assert.throws(() => parseDraft(draftResponse().replace(/seorin/g, "unknown"), plan, beat, "fixture"), /화자/);
});

test("새로고침은 실행 중 요청을 자동 반복하지 않고 저장한 초안만 복원한다", () => {
  const plan = createPlan(parseOutline(outlineFixture(), 90), base, "서린과의 약속", 90);
  plan.jobs["scene_0"] = parseDraft(draftResponse(), plan, plan.outline.scenes[0]!, "fixture");
  plan.jobs["scene_1"] = { status: "running" };
  plan.jobs["scene_2"] = { status: "error", error: "서버 오류" };
  const restored = restoreProduction(JSON.parse(JSON.stringify(plan)));
  assert.equal(restored.jobs["scene_0"]?.draft?.scene.lines.length, 30);
  assert.equal(restored.jobs["scene_1"]?.status, "pending");
  assert.equal(restored.jobs["scene_2"]?.status, "error");
  assert.equal(restored.baseFingerprint, scriptFingerprint(base));
  assert.notEqual(scriptFingerprint({ ...base, title: "수정" }), restored.baseFingerprint);
});

test("훼손된 체크포인트의 장면 연결을 거부한다", () => {
  const plan = createPlan(parseOutline(outlineFixture(), 90), base, "서린과의 약속", 90);
  plan.jobs["scene_0"] = parseDraft(draftResponse(), plan, plan.outline.scenes[0]!, "fixture");
  const corrupted = JSON.parse(JSON.stringify(plan));
  corrupted.jobs.scene_0.draft.scene.next = "missing";
  assert.throws(() => restoreProduction(corrupted), /연결/);
});

test("분기 집필은 형제 경로의 사건을 연속성으로 유입시키지 않는다", () => {
  const plan = createPlan(parseOutline(outlineFixture(), 90), base, "서린과의 약속", 90);
  const sibling = plan.outline.scenes[17]!;
  plan.jobs[sibling.id] = parseDraft(draftResponse(), plan, sibling, "fixture");
  plan.jobs[sibling.id]!.draft!.summary = "ONLY_SIBLING_SECRET";
  const prompt = makeDraftPrompt(plan, plan.outline.scenes[18]!);
  assert.ok(!prompt.includes("ONLY_SIBLING_SECRET"));
  assert.ok(prompt.includes("1600"));
  assert.ok(prompt.length <= 16000);
});

test("보강 요청으로 기존 원고를 반복해 분량을 부풀리지 못한다", () => {
  const plan = createPlan(parseOutline(outlineFixture(), 90), base, "서린과의 약속", 90);
  const beat = plan.outline.scenes[0]!;
  plan.jobs[beat.id] = parseDraft(draftResponse(), plan, beat, "fixture");
  assert.throws(() => parseDraft(draftResponse(), plan, beat, "fixture", true), /기존 원고/);
  assert.equal(plan.jobs[beat.id]!.draft!.scene.lines.length, 30);
});

test("60개 씬의 긴 설정과 연속성도 게이트웨이 프롬프트 한도 안에 압축한다", () => {
  const outline: ProductionOutline = { ...outlineFixture(), bible: "긴 설정과 말투를 보존한다.".repeat(300).slice(0, 5000), scenes: Array.from({ length: 60 }, (_, index) => ({ id: `scene_${index}`, chapter: `${index}장`, title: "유리 바다", summary: "미회수 복선이 남아 있다.".repeat(60).slice(0, 900), artDirection: "빛이 반사된 유리.".repeat(100).slice(0, 700), targetMinutes: 1.5, background: "title", ...(index === 59 ? { ending: "끝" } : { next: `scene_${index + 1}` }) })) };
  const longCast = { ...base, characters: base.characters.map(character => ({ ...character, bio: "인물의 역사".repeat(4000), name: "긴이름".repeat(300) })) };
  const plan = createPlan(parseOutline(outline, 90), longCast, "긴 기획".repeat(550), 90);
  for (const beat of plan.outline.scenes) plan.jobs[beat.id] = { status: "short", draft: { scene: scene(beat.id, 1, { next: beat.next }), summary: "직전 사건과 갈등.".repeat(100).slice(0, 600), continuity: Array.from({ length: 8 }, () => "미회수 복선".repeat(50).slice(0, 200)), model: "fixture", updatedAt: 1 } };
  assert.ok(makeDraftPrompt(plan, plan.outline.scenes[59]!).length <= 16000);
  assert.ok(makeDraftPrompt(plan, plan.outline.scenes[59]!, true).length <= 16000);
  assert.ok(makeOutlinePrompt(plan.brief, 90, longCast).length <= 16000);
});

test("기존 아트와 커스텀 표정을 보존하되 예전 씬 연결은 새 장편에 남기지 않는다", () => {
  const source = { ...base, artDirection: "유리와 황금빛", assets: [{ id: "art", name: "배경", kind: "background" as const, url: "/assets/bg/title.png", sceneId: "first" }], characters: base.characters.map(character => ({ ...character, expressionImages: { neutral: "/assets/sprite/seorin-neutral.png" } })) };
  const plan = createPlan(parseOutline(outlineFixture(), 90), source, "서린과의 약속", 90);
  const restored = restoreProduction(JSON.parse(JSON.stringify(plan)));
  assert.equal(restored.sourceAssets?.[0]?.sceneId, undefined);
  assert.equal(restored.sourceAssets?.[0]?.url, source.assets[0]?.url);
  assert.equal(planDraftScript(restored).artDirection, source.artDirection);
  assert.equal(planDraftScript(restored).characters[0]?.expressionImages?.neutral, source.characters[0]?.expressionImages?.neutral);
});
