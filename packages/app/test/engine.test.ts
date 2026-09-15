import assert from "node:assert/strict";
import { test } from "node:test";
import type { VnScript } from "@vnmaker/content";
import { reduce, rollbackLog } from "../src/engine/reducer.js";
import { initialState, readKey, ROLLBACK_LIMIT } from "../src/engine/types.js";
import { backgroundAt, cgAt, spritesAt } from "../src/engine/selectors.js";
import { autoAdvanceDelay, typewriterMsPerChar } from "../src/engine/pacing.js";
import { upcomingImages } from "../src/engine/upcomingAssets.js";

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

test("line CG cues inherit, replace, and explicitly clear the artwork at the correct position", () => {
  const scene = { ...fixture.scenes[0]!, cgUrl: "/assets/art/scene.png", lines: [
    { speaker: null, text: "시작" },
    { speaker: null, text: "전환", cgUrl: "/assets/art/event.png" },
    { speaker: null, text: "유지" },
    { speaker: null, text: "배경으로", cgUrl: null },
    { speaker: null, text: "배경 유지" },
  ] };
  assert.equal(cgAt(fixture,scene, 0), "/assets/art/scene.png");
  assert.equal(cgAt(fixture,scene, 1), "/assets/art/event.png");
  assert.equal(cgAt(fixture,scene, 2), "/assets/art/event.png");
  assert.equal(cgAt(fixture,scene, 3), undefined);
  assert.equal(cgAt(fixture,scene, 4), undefined);
});

test("line background cues seek cumulatively, survive inserted dialogue and reset at scene boundaries", () => {
  const scene = { ...fixture.scenes[0]!, backgroundUrl: "/assets/art/gallery.png", lines: [
    { speaker: null, text: "전시장" },
    { speaker: null, text: "식당으로 이동", backgroundUrl: "/assets/art/cafe.png" },
    { speaker: null, text: "식사" },
    { speaker: null, text: "강변으로 이동", backgroundUrl: "/assets/art/river.png" },
    { speaker: null, text: "강변에서 대화" },
  ] };
  assert.equal(backgroundAt(scene, -1), "/assets/art/gallery.png");
  assert.equal(backgroundAt(scene, 0), "/assets/art/gallery.png");
  assert.equal(backgroundAt(scene, 2), "/assets/art/cafe.png");
  assert.equal(backgroundAt(scene, 4), "/assets/art/river.png");
  assert.equal(backgroundAt(scene, 1), "/assets/art/cafe.png", "Seeking backward must not retain a later location.");
  const inserted = { ...scene, lines: [{ speaker: null, text: "앞에 삽입한 대사" }, ...scene.lines] };
  assert.equal(backgroundAt(inserted, 1), "/assets/art/gallery.png");
  assert.equal(backgroundAt(inserted, 2), "/assets/art/cafe.png");
  assert.equal(backgroundAt(fixture.scenes[1]!, 0), undefined, "A new scene without a URL uses its own manifest background.");
});

test("background changes remain underneath CG and keep actor expression cues intact", () => {
  const scene: VnScript["scenes"][number] = { ...fixture.scenes[0]!, backgroundUrl: "/assets/art/start.png", lines: [
    { speaker: "seorin", text: "손을 잡는다", expression: "smile", cgUrl: "/assets/art/hands.png" },
    { speaker: null, text: "장소가 바뀐다", backgroundUrl: "/assets/art/river.png" },
    { speaker: null, text: "CG가 끝난다", cgUrl: null },
  ] };
  assert.equal(cgAt(fixture,scene, 1), "/assets/art/hands.png");
  assert.equal(backgroundAt(scene, 1), "/assets/art/river.png");
  assert.equal(cgAt(fixture,scene, 2), undefined);
  assert.equal(backgroundAt(scene, 2), "/assets/art/river.png");
  assert.equal(spritesAt(scene, 2)[0]?.expression, "smile");
});

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
  s = reduce(fixture, s, { type: "skipToChoice" });
  s = reduce(fixture, s, { type: "choose", index: 0 });
  assert.equal(s.sceneId, "b");
  assert.equal(s.affection, 2);
  assert.equal(s.lineIndex, 0);
});

test("호감도 없는 선택지는 0 을 더한다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipToChoice" });
  s = reduce(fixture, s, { type: "choose", index: 1 });
  assert.equal(s.sceneId, "c");
  assert.equal(s.affection, 0);
});

test("ending 이 있는 씬을 지나면 엔딩 단계가 된다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipToChoice" });
  s = reduce(fixture, s, { type: "choose", index: 0 });
  s = reduce(fixture, s, { type: "advance" });
  assert.equal(s.phase, "ending");
  assert.equal(s.endingTitle, "좋은 끝");
});

test("없는 씬을 가리키면 던지지 않고 error 에 남는다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipToChoice" });
  s = reduce(fixture, s, { type: "choose", index: 1 });
  s = reduce(fixture, s, { type: "advance" });
  assert.equal(s.phase, "scene");
  assert.match(s.error ?? "", /missing-scene/);
});

test("없는 선택지 인덱스도 던지지 않는다", () => {
  let s = reduce(fixture, initialState(fixture), { type: "start" });
  s = reduce(fixture, s, { type: "skipToChoice" });
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
  const jumped = reduce(fixture, reduce(fixture, start, { type: "skipToChoice" }), { type: "choose", index: 0 });
  assert.ok(jumped.sceneEpoch > start.sceneEpoch);
});

test("말하는 인물의 표정은 줄 단위로 덮어쓴다", () => {
  const scene = fixture.scenes[0];
  assert.ok(scene);
  assert.equal(spritesAt(scene, 0)[0]?.expression, "neutral");
  assert.equal(spritesAt(scene, 1)[0]?.expression, "smile");
});

test("history snapshots source chapters for normal advances, skips and selected choices",()=>{
  const script={...fixture,scenes:fixture.scenes.map((scene,index)=>({...scene,chapter:`장 ${index+1}`}))};
  let state=reduce(script,initialState(script),{type:"start"});state=reduce(script,state,{type:"advance"});state=reduce(script,state,{type:"skipToChoice"});state=reduce(script,state,{type:"choose",index:0});
  assert.deepEqual(state.history.map(row=>[row.sceneId,row.chapter]),[["a","장 1"],["a","장 1"],["a","장 1"]]);
  state=reduce(script,state,{type:"advance"});assert.equal(state.history.at(-1)?.chapter,"장 2");
  const revised={...script,scenes:script.scenes.map(scene=>({...scene,chapter:"바뀐 제목"}))};
  const restored=reduce(revised,initialState(revised),{type:"restore",sceneId:"b",lineIndex:0,affection:0,history:state.history});
  assert.equal(restored.history[0]?.chapter,"장 1");
});

test("scene.cg 에셋 id 가 cgAt 에서 주소로 해석된다", () => {
  const script = { ...fixture, assets: [{ id: "event-1", name: "이벤트", kind: "cg" as const, url: "/assets/art/e1.png" }] };
  const scene = { ...fixture.scenes[0]!, cg: "event-1", lines: [{ speaker: null, text: "a" }, { speaker: null, text: "b" }] };
  assert.equal(cgAt(script, scene, 0), "/assets/art/e1.png");
  assert.equal(cgAt(script, scene, 1), "/assets/art/e1.png");
});

test("cgHide 는 그 줄에서만 CG 를 숨기고 다음 줄에 복귀한다", () => {
  const scene = { ...fixture.scenes[0]!, cgUrl: "/assets/art/event.png", lines: [
    { speaker: null, text: "CG 등장" },
    { speaker: null, text: "잠깐 배경", cgHide: true },
    { speaker: null, text: "CG 복귀" },
    { speaker: null, text: "CG 해제", cgUrl: null },
    { speaker: null, text: "배경" },
  ] };
  assert.equal(cgAt(fixture, scene, 0), "/assets/art/event.png");
  assert.equal(cgAt(fixture, scene, 1), undefined);
  assert.equal(cgAt(fixture, scene, 2), "/assets/art/event.png");
  assert.equal(cgAt(fixture, scene, 3), undefined);
  assert.equal(cgAt(fixture, scene, 4), undefined);
});

test("back 은 직전 줄로 되돌리고 flags·history·씬 경계까지 복원한다", () => {
  let state = reduce(fixture, initialState(fixture), { type: "start" });
  state = reduce(fixture, state, { type: "advance" });
  assert.equal(state.lineIndex, 1);
  state = reduce(fixture, state, { type: "back" });
  assert.equal(state.lineIndex, 0);
  assert.equal(state.history.length, 0, "되돌리면 그 줄의 기록도 롤백된다");
  // 더 이상 되돌릴 게 없으면 멈춘다
  assert.equal(reduce(fixture, state, { type: "back" }).lineIndex, 0);
});

test("선택 후 back 은 선택지로 복귀한다", () => {
  let state = reduce(fixture, initialState(fixture), { type: "start" });
  state = reduce(fixture, state, { type: "advance" });
  state = reduce(fixture, state, { type: "advance" });
  assert.equal(state.phase, "choice");
  state = reduce(fixture, state, { type: "choose", index: 0 });
  assert.equal(state.sceneId, "b");
  state = reduce(fixture, state, { type: "back" });
  assert.equal(state.phase, "choice");
  assert.equal(state.sceneId, "a");
  // 다른 선택지로 다시 갈 수 있다
  state = reduce(fixture, state, { type: "choose", index: 1 });
  assert.equal(state.sceneId, "c");
});

test("skipToChoice 는 다음 선택지에서 멈추고 한 번의 back 으로 되돌아온다", () => {
  let state = reduce(fixture, initialState(fixture), { type: "start" });
  state = reduce(fixture, state, { type: "skipToChoice" });
  assert.equal(state.phase, "choice");
  assert.equal(state.sceneId, "a");
  state = reduce(fixture, state, { type: "back" });
  assert.equal(state.phase, "scene");
  assert.equal(state.lineIndex, 0);
});

test("스프라이트 의상은 덮어쓰기·유지·null 복귀한다", () => {
  const scene = { ...fixture.scenes[0]!, sprites: [{ slot: "center" as const, character: "seorin", expression: "neutral", outfit: "school" }], lines: [
    { speaker: null, text: "교복" },
    { speaker: null, text: "표정만", sprites: [{ slot: "center" as const, character: "seorin", expression: "smile" }] },
    { speaker: null, text: "사복으로", sprites: [{ slot: "center" as const, character: "seorin", outfit: "casual" }] },
    { speaker: null, text: "기본으로", sprites: [{ slot: "center" as const, character: "seorin", outfit: null }] },
  ] };
  assert.equal(spritesAt(scene, 0)[0]?.outfit, "school");
  assert.equal(spritesAt(scene, 1)[0]?.outfit, "school", "표정만 바꿔도 의상 유지");
  assert.equal(spritesAt(scene, 2)[0]?.outfit, "casual");
  assert.equal(spritesAt(scene, 3)[0]?.outfit, null);
});

// ---- 2026-09-14 적대적 리뷰 회귀 테스트 ------------------------------------------

test("restore 는 고를 수 있는 선택지가 하나도 없는 선택 단계로 조용히 들어가지 않는다 (소프트락)", () => {
  const gated: VnScript = { ...fixture, scenes: [{ ...fixture.scenes[0]!, choices: [{ text: "비밀", next: "b", when: { all: ["secret"] } }, { text: "잠김", next: "c", disable: true }] }, ...fixture.scenes.slice(1)] };
  // 저장 당시에는 secret 이 참이었지만 원고가 바뀌어 지금은 아무 선택지도 열리지 않는다.
  const restored = reduce(gated, initialState(gated), { type: "restore", sceneId: "a", lineIndex: 1, affection: 0, phase: "choice", flags: {} });
  assert.notEqual(restored.phase, "choice");
  assert.match(restored.error ?? "", /선택할 수 있는 선택지가 없습니다/);
  // 선택지가 열려 있으면 그대로 선택 단계로 복원된다.
  const open = reduce(gated, initialState(gated), { type: "restore", sceneId: "a", lineIndex: 1, affection: 0, phase: "choice", flags: { secret: true } });
  assert.equal(open.phase, "choice"); assert.equal(open.error, null);
});

test("skipToChoice 는 씬 경계에서 멈추고 순환하는 next 에서도 기록이 폭주하지 않는다", () => {
  const cycle: VnScript = { ...fixture, start: "x", scenes: [
    { id: "x", background: "title", lines: [{ speaker: null, text: "x1" }, { speaker: null, text: "x2" }], next: "y" },
    { id: "y", background: "title", lines: [{ speaker: null, text: "y1" }], next: "x" },
  ] };
  let state = reduce(cycle, initialState(cycle), { type: "start" });
  state = reduce(cycle, state, { type: "skipToChoice" });
  assert.equal(state.sceneId, "y", "한 씬만 넘어가 다음 씬 첫 줄에서 멈춘다");
  assert.equal(state.lineIndex, 0);
  assert.equal(state.history.length, 2);
  assert.equal(state.past.length, 1, "한 번의 back 으로 되돌아온다");
  for (let i = 0; i < 50; i += 1) state = reduce(cycle, state, { type: "skipToChoice" });
  assert.ok(state.history.length < 200, `순환 스킵 50회 뒤 기록 ${state.history.length}개`);
  assert.equal(state.error, null);
});

test("skipToChoice 는 엔딩 씬에서는 마지막 줄에 멈추고, 선택지 씬에서는 선택 단계로 간다", () => {
  const ending: VnScript = { ...fixture, start: "e", scenes: [{ id: "e", background: "title", lines: [{ speaker: null, text: "e1" }, { speaker: null, text: "e2" }, { speaker: null, text: "e3" }], ending: "끝" }] };
  let state = reduce(ending, initialState(ending), { type: "start" });
  state = reduce(ending, state, { type: "skipToChoice" });
  assert.equal(state.phase, "scene"); assert.equal(state.lineIndex, 2);
  const again = reduce(ending, state, { type: "skipToChoice" });
  assert.strictEqual(again, state, "더 갈 곳이 없으면 상태(past 포함)를 바꾸지 않는다");
  assert.equal(reduce(ending, state, { type: "advance" }).phase, "ending");
  let choice = reduce(fixture, initialState(fixture), { type: "start" });
  choice = reduce(fixture, choice, { type: "skipToChoice" });
  assert.equal(choice.phase, "choice");
});

test("readKeys 가 주어지면 읽지 않은 대사 앞에서 멈춘다 (읽은 텍스트만 스킵)", () => {
  const long: VnScript = { ...fixture, start: "r", scenes: [{ id: "r", background: "title", lines: [{ speaker: null, text: "1" }, { speaker: null, text: "2", id: "second" }, { speaker: null, text: "3" }, { speaker: null, text: "4" }], next: "b" }, fixture.scenes[1]!] };
  const start = reduce(long, initialState(long), { type: "start" });
  const read = new Set([readKey("r", 1, { id: "second" }), readKey("r", 2)]);
  const skipped = reduce(long, start, { type: "skipToChoice", readKeys: read });
  assert.equal(skipped.lineIndex, 2, "3번째 줄까지 읽었으니 4번째 줄(미독) 앞에서 멈춘다");
  assert.equal(skipped.past.length, 1);
  const stuck = reduce(long, skipped, { type: "skipToChoice", readKeys: read });
  assert.strictEqual(stuck, skipped, "바로 다음 줄이 미독이면 아무것도 하지 않는다");
  const everything = reduce(long, start, { type: "skipToChoice" });
  assert.equal(everything.sceneId, "b", "readKeys 가 없으면(모두 스킵) 씬 끝까지 간다");
});

test("세이브의 롤백 기록으로 불러온 뒤에도 back 이 동작한다", () => {
  const script = { ...fixture, scenes: [{ ...fixture.scenes[0]!, lines: [{ speaker: null, text: "1" }, { speaker: null, text: "2" }, { speaker: null, text: "3" }] }, ...fixture.scenes.slice(1)] };
  let state = reduce(script, initialState(script), { type: "start" });
  state = reduce(script, state, { type: "advance" }); state = reduce(script, state, { type: "advance" });
  const rollback = rollbackLog(state, ROLLBACK_LIMIT);
  assert.equal(rollback.length, 2); assert.equal(rollback[1]?.historyLength, 1);
  const restored = reduce(script, initialState(script), { type: "restore", sceneId: state.sceneId, lineIndex: state.lineIndex, affection: 0, flags: state.flags, history: state.history, rollback });
  assert.equal(restored.past.length, 2);
  const back = reduce(script, restored, { type: "back" });
  assert.equal(back.lineIndex, 1); assert.equal(back.history.length, 1); assert.equal(back.history[0]?.text, "1");
  const twice = reduce(script, back, { type: "back" });
  assert.equal(twice.lineIndex, 0); assert.equal(twice.history.length, 0);
  assert.equal(reduce(script, twice, { type: "back" }).lineIndex, 0, "기록이 끝나면 멈춘다");
  // 없는 씬을 가리키는 기록은 버린다.
  const dirty = reduce(script, initialState(script), { type: "restore", sceneId: "a", lineIndex: 2, affection: 0, rollback: [{ sceneId: "ghost", lineIndex: 0, affection: 0, flags: {}, phase: "scene", historyLength: 0 }, ...rollback] });
  assert.equal(dirty.past.length, 2);
});

test("오토 대기는 20초를 넘지 않고, 글자 속도는 아주 긴 줄에서 12초 안에 끝나도록 빨라진다", () => {
  assert.equal(autoAdvanceDelay(10, 45), 1150);
  assert.equal(autoAdvanceDelay(20_000, 45), 20_000);
  assert.equal(autoAdvanceDelay(0), 700);
  assert.equal(typewriterMsPerChar(20, 28), 28);
  assert.ok(typewriterMsPerChar(20_000, 28) * 20_000 <= 12_000);
  assert.equal(typewriterMsPerChar(20_000, 0), 0, "즉시 표시는 그대로");
});

test("upcomingImages 는 남은 연출 컷과 next·선택지 대상 씬의 첫 화면을 중복 없이 모은다", () => {
  const script: VnScript = { ...fixture, characters: [{ id: "seorin", name: "한서린", color: "#000", bio: "", expressionImages: { neutral: "/assets/art/seorin-neutral.png", smile: "/assets/art/seorin-smile.png" } }], scenes: [
    { id: "a", background: "title", lines: [{ speaker: null, text: "1" }, { speaker: null, text: "2", cgUrl: "/assets/art/event.png" }, { speaker: null, text: "3", backgroundUrl: "/assets/art/river.png", sprites: [{ slot: "left", character: "seorin", expression: "smile" }] }], choices: [{ text: "b", next: "b" }, { text: "c", next: "c" }] },
    { id: "b", background: "title", backgroundUrl: "/assets/art/library.png", sprites: [{ slot: "center", character: "seorin" }], lines: [{ speaker: null, text: "b" }], ending: "끝" },
    { id: "c", background: "atrium", lines: [{ speaker: null, text: "c" }], next: "b" },
  ] };
  const urls = upcomingImages(script, script.scenes[0]!, 0);
  assert.deepEqual(urls, ["/assets/art/event.png", "/assets/art/river.png", "/assets/art/seorin-smile.png", "/assets/art/library.png", "/assets/art/seorin-neutral.png", "/assets/bg/atrium.png"]);
  assert.deepEqual(upcomingImages(script, script.scenes[2]!, 0), ["/assets/art/library.png", "/assets/art/seorin-neutral.png"]);
  assert.deepEqual(upcomingImages(script, script.scenes[1]!, 0), [], "엔딩 씬 뒤에는 미리 받을 것이 없다");
});
