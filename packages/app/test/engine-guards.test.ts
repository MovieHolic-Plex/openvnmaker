import assert from "node:assert/strict";
import { test } from "node:test";
import { auditScript, type VnScript } from "@vnmaker/content";
import { reduce } from "../src/engine/reducer.js";
import { hasReadKey, initialState, readKey } from "../src/engine/types.js";
import { spritesAt } from "../src/engine/selectors.js";
import { typewriterMsPerChar } from "../src/engine/pacing.js";
import { coerceFlags, invalidateStorageCache, readLineKeys, readSlot, rememberRead, writeSlot, SLOT_COUNT, READ_LIMIT, type SlotSave } from "../src/storage/persist.js";

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
    },
  };
  return store;
}

const base: VnScript = {
  title: "t",
  subtitle: "",
  start: "a",
  characters: [{ id: "seorin", name: "한서린", color: "#000", bio: "" }],
  scenes: [
    { id: "a", background: "b", lines: [{ speaker: null, text: "a0" }, { speaker: null, text: "a1" }], next: "b" },
    { id: "b", background: "b", lines: [{ speaker: null, text: "b0" }], ending: "끝" },
  ],
};

test("enterScene: 지나온 씬의 set이 허브의 가려진 줄을 열었으면 재진입은 순환이 아니다", () => {
  const script: VnScript = {
    ...base,
    start: "hub",
    flags: { unlocked: false },
    scenes: [
      { id: "hub", background: "b", lines: [{ speaker: null, text: "보임", when: { all: ["unlocked"] } }], next: "spoke" },
      { id: "spoke", background: "b", set: { unlocked: true }, lines: [{ speaker: null, text: "숨김", when: { all: ["never"] } }], next: "hub" },
    ],
  };
  const state = reduce(script, initialState(script), { type: "start" });
  assert.equal(state.error, null);
  assert.equal(state.sceneId, "hub");
  assert.equal(state.phase, "scene");
  assert.equal(state.lineIndex, 0);
});

test("enterScene: 재방문 씬의 조건 경로가 새 플래그로 열렸으면 순환이 아니다(A→B→C→B)", () => {
  const script: VnScript = {
    ...base,
    start: "a",
    scenes: [
      { id: "a", background: "b", lines: [{ speaker: null, text: "숨김", when: { all: ["z"] } }], next: "b" },
      { id: "b", background: "b", lines: [{ speaker: null, text: "숨김", when: { all: ["z"] } }],
        routes: [{ next: "d", when: { all: ["x"] } }, { next: "c" }] },
      { id: "c", background: "b", set: { x: true }, lines: [{ speaker: null, text: "숨김", when: { all: ["z"] } }], next: "b" },
      { id: "d", background: "b", lines: [{ speaker: null, text: "도착" }], ending: "끝" },
    ],
  };
  const state = reduce(script, initialState(script), { type: "start" });
  assert.equal(state.error, null);
  assert.equal(state.sceneId, "d");
});

test("enterScene: set이 매번 토글되는 가려진 고리는 홉 상한에서 멈춘다", () => {
  const script: VnScript = {
    ...base,
    start: "a",
    scenes: [
      { id: "a", background: "b", set: { x: true }, lines: [{ speaker: null, text: "숨김", when: { all: ["z"] } }], next: "b" },
      { id: "b", background: "b", set: { x: false }, lines: [{ speaker: null, text: "숨김", when: { all: ["z"] } }], next: "a" },
    ],
  };
  const state = reduce(script, initialState(script), { type: "start" });
  assert.ok(state.error !== null);
});

test("enterScene: 진짜 순환(전부 가려진 씬의 고리)은 여전히 치명 오류다", () => {
  const script: VnScript = {
    ...base,
    start: "hub",
    scenes: [
      { id: "hub", background: "b", lines: [{ speaker: null, text: "숨김", when: { all: ["never"] } }], next: "spoke" },
      { id: "spoke", background: "b", lines: [{ speaker: null, text: "숨김", when: { all: ["never"] } }], next: "hub" },
    ],
  };
  const state = reduce(script, initialState(script), { type: "start" });
  assert.match(state.error ?? "", /순환/);
});

test("치명 오류 상태에서는 진행·입력·선택이 past/history 를 오염시키지 않는다", () => {
  let state = reduce(base, initialState(base), { type: "start" });
  state = reduce(base, state, { type: "advance" });
  state = reduce(base, state, { type: "advance" }); // scene a 끝 → b 진입
  const past = state.past.length;
  const history = state.history.length;
  const broken = reduce(base, state, { type: "restore", sceneId: "missing", lineIndex: 0, affection: 0 });
  assert.notEqual(broken.error, null);
  const after = [broken, reduce(base, broken, { type: "advance" }), reduce(base, broken, { type: "skipToChoice" }), reduce(base, broken, { type: "input", flag: "x", value: "1" }), reduce(base, broken, { type: "choose", index: 0 })];
  for (const next of after.slice(1)) {
    assert.equal(next.past.length, past);
    assert.equal(next.history.length, history);
    assert.notEqual(next.error, null);
  }
  // 되돌리기는 여전히 복구 경로다.
  const recovered = reduce(base, broken, { type: "back" });
  assert.equal(recovered.error, null);
});

test("input으로 넣은 플래그는 다음 씬의 진입 set이 덮어쓰지 않는다", () => {
  const script: VnScript = {
    ...base,
    scenes: [
      { id: "a", background: "b", lines: [{ speaker: null, text: "이름?", input: { flag: "player" } }, { speaker: null, text: "끝" }], next: "b" },
      { id: "b", background: "b", set: { player: "기본값", mood: "calm" }, lines: [{ speaker: null, text: "{player}님" }], ending: "끝" },
    ],
  };
  let state = reduce(script, initialState(script), { type: "start" });
  state = reduce(script, state, { type: "input", flag: "player", value: "소라" });
  state = reduce(script, state, { type: "advance" }); // b 진입
  assert.equal(state.sceneId, "b");
  assert.equal(state.flags["player"], "소라");
  // set 의 다른 키는 그대로 적용된다 — 보호는 입력으로 쓴 키만이다.
  assert.equal(state.flags["mood"], "calm");
  // 되돌리기로 입력 전(pre-input)까지 가면 보호 목록도 함께 되돌아간다.
  const rewound = reduce(script, reduce(script, state, { type: "back" }), { type: "back" });
  assert.equal(rewound.inputFlags.length, 0);
});

test("대사 기록은 상한을 넘지 않는다 — 자동 저장이 선형 비용을 유지한다", () => {
  const script: VnScript = { ...base, scenes: [{ id: "a", background: "b", lines: Array.from({ length: 2100 }, (_, i) => ({ speaker: null, text: `줄${i}` })), ending: "끝" }] };
  let state = reduce(script, initialState(script), { type: "start" });
  for (let i = 0; i < 2005; i += 1) state = reduce(script, state, { type: "advance" });
  assert.ok(state.history.length <= 2000, `history ${state.history.length} ≤ 2000`);
});

test("restore 롤백 재구성 — 전부 가려진 씬은 건너뛰고, 고를 수 없는 선택지는 scene으로 낮춘다", () => {
  const script: VnScript = {
    ...base,
    scenes: [
      { id: "a", background: "b", lines: [{ speaker: null, text: "a0" }], next: "hidden" },
      { id: "hidden", background: "b", lines: [{ speaker: null, text: "숨김", when: { all: ["never"] } }], next: "c" },
      { id: "c", background: "b", lines: [{ speaker: null, text: "c0" }], choices: [{ text: "닫힘", next: "a", when: { all: ["never"] } }] },
    ],
  };
  const state = reduce(script, initialState(script), {
    type: "restore", sceneId: "a", lineIndex: 0, affection: 0,
    rollback: [
      { sceneId: "hidden", lineIndex: 0, affection: 0, flags: {}, phase: "scene", historyLength: 0 },
      { sceneId: "c", lineIndex: 0, affection: 0, flags: {}, phase: "choice", historyLength: 0 },
    ],
  });
  assert.equal(state.error, null);
  assert.equal(state.past.length, 1);
  assert.equal(state.past[0]!.sceneId, "c");
  assert.equal(state.past[0]!.phase, "scene");
});

test("hasReadKey — 줄에 id가 생겨도 예전 위치 키(씬#3)를 읽은 것으로 본다", () => {
  const read = new Set(["s#3", "s#id:other"]);
  assert.equal(hasReadKey(read, "s", 3, { id: "line-x" }), true);
  assert.equal(hasReadKey(read, "s", 4, { id: "line-y" }), false);
  assert.equal(hasReadKey(read, "s", 3), true);
  assert.equal(readKey("s", 3, { id: "3" }), "s#id:3");
});

test("선택지 affection 합산이 무한대로 넘치면 이전 값을 유지한다", () => {
  const script: VnScript = {
    ...base,
    scenes: [{ id: "a", background: "b", lines: [{ speaker: null, text: "a0" }], choices: [{ text: "x", next: "b", affection: 1e308 }] }, base.scenes[1]!],
  };
  let state = reduce(script, initialState(script), { type: "start" });
  state = { ...state, affection: 1e308 };
  state = reduce(script, state, { type: "advance" });
  state = reduce(script, state, { type: "choose", index: 0 });
  assert.ok(Number.isFinite(state.affection));
});

test("같은 줄의 명시적 표정 지정이 화자 표현 단축키보다 우선한다", () => {
  const scene = {
    ...base.scenes[0]!,
    sprites: [{ slot: "center" as const, character: "seorin", expression: "neutral" }],
    lines: [{ speaker: "seorin", text: "대사", expression: "smile", sprites: [{ slot: "center" as const, character: "seorin", expression: "angry" }] }],
  };
  const dirs = spritesAt(scene, 0, {});
  assert.equal(dirs.find(d => d.slot === "center")?.expression, "angry");
});

test("typewriterMsPerChar — NaN 속도는 즉시 표시로 둔다", () => {
  assert.equal(typewriterMsPerChar(10, Number.NaN), 0);
  assert.equal(typewriterMsPerChar(10, 50) > 0, true);
});

test("auditScript — 무조건 input 플래그에 0이 들어오면 선택지가 닫히는 경로를 경고한다", () => {
  const script: VnScript = {
    ...base,
    scenes: [
      { id: "a", background: "b", lines: [{ speaker: null, text: "숫자?", input: { flag: "x" } }], next: "b" },
      { id: "b", background: "b", lines: [{ speaker: null, text: "b0" }], choices: [{ text: "x 있을 때만", next: "a", when: { all: ["x"] } }] },
    ],
  };
  const issues = auditScript(script);
  // 입력값 0으로 도달한 상태는 선택지가 전부 닫히는 확정 데드엔드다.
  assert.ok(issues.some(issue => issue.message.includes("선택지가 모두 닫힙니다")), JSON.stringify(issues));
});

test("coerceFlags — 200자를 넘는 문자열 플래그 값은 버린다", () => {
  const flags = coerceFlags({ ok: "x".repeat(200), long: "y".repeat(201), num: 3 });
  assert.equal(flags?.["ok"], "x".repeat(200));
  assert.equal("long" in (flags ?? {}), false);
  assert.equal(flags?.["num"], 3);
});

test("writeSlot — 검증을 통과 못한 다른 슬롯 행을 지우지 않는다", () => {
  const store = installMemoryStorage();
  const broken = { weird: true, sceneId: 42 };
  store.set("vnmaker:slots", JSON.stringify([null, broken, null, null, null, null]));
  invalidateStorageCache();
  const save: SlotSave = { sceneId: "s", lineIndex: 0, affection: 0, savedAt: 1, preview: "", chapter: null, thumbnail: null };
  assert.equal(writeSlot(0, save), true);
  const rows = JSON.parse(store.get("vnmaker:slots")!) as unknown[];
  assert.deepEqual(rows[1], broken);
  assert.equal(SLOT_COUNT, 6);
});

test("rememberRead — 정수처럼 보이는 씬 id도 삽입 순서대로 잊는다", () => {
  const store = installMemoryStorage();
  // "z"가 오래된 씬, "3"은 방금 읽은 씬 — 정수 키가 Object.keys에서 앞으로 정렬돼도 "z"가 먼저 잊혀야 한다.
  const zLines = Array.from({ length: READ_LIMIT - 1 }, (_, i) => `${i}`);
  store.set("vnmaker:read", JSON.stringify({ z: zLines }));
  invalidateStorageCache();
  assert.equal(rememberRead(["3#a", "3#b", "z#new"]), true);
  invalidateStorageCache();
  const read = readLineKeys();
  assert.equal(read.has("3#a"), true);
  assert.equal(read.has("z#0"), false);
});

test("readSlot — 미래로 위조된 savedAt은 0으로 정규화돼 최신 저장 자리를 못 잡는다", () => {
  const store = installMemoryStorage();
  const forged = { sceneId: "s", lineIndex: 0, affection: 0, savedAt: Date.now() + 10 * 86_400_000, preview: "", chapter: null, thumbnail: null };
  const honest = { sceneId: "s", lineIndex: 1, affection: 0, savedAt: 5, preview: "", chapter: null, thumbnail: null };
  store.set("vnmaker:slots", JSON.stringify([forged, honest]));
  invalidateStorageCache();
  assert.equal(readSlot(0)?.savedAt, 0);
  assert.equal(readSlot(1)?.savedAt, 5);
});
