import assert from "node:assert/strict";
import { test } from "node:test";
import {
  latestSave,
  listSlots,
  readAutoSlot,
  readSlot,
  SLOT_COUNT,
  writeAutoSlot,
  writeSlot,
  type SlotSave,
} from "../src/storage/persist.js";

const LEGACY_KEY = "vnmaker:save";
const SLOTS_KEY = "vnmaker:slots";

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  };
  return store;
}

function slotFixture(index: number): SlotSave {
  return {
    sceneId: `s0${index}-test`,
    lineIndex: index,
    affection: index * 2,
    savedAt: 1700000000000 + index * 1000,
    preview: `미리보기 문장 ${index}`,
    chapter: index % 2 === 0 ? `제${index + 1}장` : null,
    thumbnail: `/assets/art/bg-${index}.png`,
  };
}

test("슬롯은 6개이며 비어 있을 때는 모두 null 이다", () => {
  installMemoryStorage();
  assert.equal(SLOT_COUNT, 6);
  const slots = listSlots();
  assert.equal(slots.length, 6);
  assert.ok(slots.every((slot) => slot === null));
});

test("6개 슬롯에 저장한 내용이 그대로 돌아온다", () => {
  installMemoryStorage();
  for (let i = 0; i < 6; i += 1) {
    writeSlot(i, slotFixture(i));
  }
  for (let i = 0; i < 6; i += 1) {
    const loaded = readSlot(i);
    assert.deepEqual(loaded, slotFixture(i));
  }
  const slots = listSlots();
  assert.equal(slots.length, 6);
  assert.equal(slots[5]?.preview, "미리보기 문장 5");
  assert.equal(slots[5]?.thumbnail, "/assets/art/bg-5.png");
});

test("자동 슬롯은 선택지/엔딩 시점의 스냅샷을 덮어쓴다", () => {
  installMemoryStorage();
  assert.equal(readAutoSlot(), null);
  writeAutoSlot({ ...slotFixture(0), sceneId: "s04-lawn", preview: "선택지 직전" });
  assert.equal(readAutoSlot()?.preview, "선택지 직전");
  // 엔딩에서 다시 쓰면 최신 스냅샷으로 바뀐다.
  writeAutoSlot({ ...slotFixture(0), sceneId: "ending-scene", preview: "엔딩 도달" });
  assert.equal(readAutoSlot()?.sceneId, "ending-scene");
  assert.equal(readAutoSlot()?.preview, "엔딩 도달");
});

test("옛날 단일 키(vnmaker:save)도 이어서 읽기 대상으로 살아 있다", () => {
  const store = installMemoryStorage();
  store.set(
    LEGACY_KEY,
    JSON.stringify({ sceneId: "s02-old", lineIndex: 3, affection: 5, savedAt: 1699999999000 }),
  );
  assert.equal(readSlot(0), null);
  // 슬롯 이주 대신 latestSave 가 레거시 키를 직접 읽는다 — 구버전 저장도 버려지지 않는다.
  const resumed = latestSave();
  assert.ok(resumed !== null);
  assert.equal(resumed?.sceneId, "s02-old");
  assert.equal(resumed?.lineIndex, 3);
  assert.equal(resumed?.affection, 5);
  // 더 새로운 슬롯 저장이 있으면 그쪽이 우선한다.
  writeSlot(1, { ...slotFixture(1), savedAt: 1700000001000 });
  assert.equal(latestSave()?.sceneId, slotFixture(1).sceneId);
});

// ---- 2026-09-14 적대적 리뷰 회귀 테스트 ------------------------------------------
import { script as sample, type VnScript } from "@vnmaker/content";
import { invalidateStorageCache, loadSave, loadSettings, manuscriptFor, readLineKeys, readQuickSlot, reconcileFlags, rememberRead, writeQuickSlot, writeSettings, READ_LIMIT } from "../src/storage/persist.js";
import { manuscriptFingerprint } from "../src/storage/manuscriptKey.js";

const tiny: VnScript = { title: "원고 A", subtitle: "", start: "s", flags: { score: 0, route: "none" }, characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "a" }], choices: [{ text: "더하기", next: "s", add: { score: 1 } }] }] };
const tinyB: VnScript = { ...tiny, title: "원고 B" };

test("세이브는 원고를 매번 내장하지 않고 보관함의 지문으로 가리키며, 구형식(내장) 세이브도 그대로 읽힌다", () => {
  const store = installMemoryStorage(); invalidateStorageCache();
  const save: SlotSave = { ...slotFixture(0), sceneId: "s", lineIndex: 0, script: tiny, flags: { score: 2, route: "none" } };
  assert.equal(writeSlot(0, save), true);
  assert.equal(writeAutoSlot({ ...save, savedAt: 9 }), true);
  const rawSlots = store.get(SLOTS_KEY)!, rawAuto = store.get("vnmaker:auto")!;
  assert.ok(!rawSlots.includes('"title":"원고 A"'), "슬롯 목록에 원고가 내장되지 않는다");
  assert.ok(!rawAuto.includes('"title":"원고 A"'), "자동 저장에 원고가 내장되지 않는다");
  assert.ok(rawAuto.length < 600, `자동 저장 스냅숏 ${rawAuto.length}B`);
  const manuscripts = JSON.parse(store.get("vnmaker:manuscripts")!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(manuscripts), [manuscriptFingerprint(tiny)], "같은 원고는 한 번만 보관한다");
  assert.equal(readSlot(0)?.script?.title, "원고 A"); assert.equal(readAutoSlot()?.script?.title, "원고 A");
  assert.equal(readSlot(0)?.scriptKey, manuscriptFingerprint(tiny));
  // 구형식: 원고를 내장한 세이브
  store.set("vnmaker:save", JSON.stringify({ sceneId: "s", lineIndex: 0, affection: 0, savedAt: 99, script: tinyB }));
  assert.equal(loadSave()?.script?.title, "원고 B");
});

test("보관함은 어떤 세이브도 가리키지 않는 원고를 새 원고가 들어올 때 정리한다", () => {
  const store = installMemoryStorage(); invalidateStorageCache();
  writeSlot(0, { ...slotFixture(0), sceneId: "s", script: tiny });
  writeSlot(0, { ...slotFixture(0), sceneId: "s", script: tinyB });
  const keys = Object.keys(JSON.parse(store.get("vnmaker:manuscripts")!) as object);
  assert.deepEqual(keys, [manuscriptFingerprint(tinyB)], "A 를 가리키는 세이브가 없어졌으니 A 는 지운다");
  assert.equal(manuscriptFor(manuscriptFingerprint(tiny)), null);
  assert.equal(readSlot(0)?.script?.title, "원고 B");
});

test("같은 원문이면 슬롯 목록을 다시 파싱하지 않는다 (저장 창이 열린 채 타이핑되는 동안)", () => {
  installMemoryStorage(); invalidateStorageCache();
  for (let i = 0; i < 6; i += 1) writeSlot(i, { ...slotFixture(i), sceneId: "s", script: sample });
  const original = JSON.parse; let parses = 0;
  JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => { parses += 1; return original(text, reviver); }) as typeof JSON.parse;
  try {
    listSlots(); readAutoSlot(); readQuickSlot();
    const first = parses;
    assert.ok(first > 0);
    for (let frame = 0; frame < 60; frame += 1) { listSlots(); readAutoSlot(); readQuickSlot(); }
    assert.equal(parses, first, "60프레임 동안 추가 파싱이 없어야 한다");
    writeSlot(2, { ...slotFixture(2), sceneId: "s", script: sample });
    listSlots();
    assert.ok(parses > first, "저장이 바뀌면 다시 읽는다");
  } finally { JSON.parse = original; }
});

test("복원한 선택 기억의 타입이 원고 초기값과 다르면 초기값으로 되돌린다 (죽은 선택지 버튼 방지)", () => {
  assert.deepEqual(reconcileFlags({ score: "abc", route: "ally", extra: 1 }, { score: 0, route: "none" }), { score: 0, route: "ally", extra: 1 });
  assert.equal(reconcileFlags(undefined, { score: 0 }), undefined);
  assert.deepEqual(reconcileFlags({ score: 3 }, undefined), { score: 3 });
  const store = installMemoryStorage(); invalidateStorageCache();
  store.set(SLOTS_KEY, JSON.stringify([{ sceneId: "s", lineIndex: 0, affection: 0, savedAt: 1, script: tiny, flags: { score: "abc" }, phase: "choice" }]));
  assert.deepEqual(readSlot(0)?.flags, { score: 0 }, "내장 원고가 있으면 읽을 때 바로 맞춘다");
});

test("자동 저장이 저장 공간 부족으로 실패하면 기록을 줄여 다시 시도한다", () => {
  const data = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { if (value.length > 6000) throw new Error("QuotaExceededError"); data.set(key, value); } } };
  invalidateStorageCache();
  const history = Array.from({ length: 400 }, (_, i) => ({ speaker: null, text: `기록 ${i}` }));
  assert.equal(writeAutoSlot({ ...slotFixture(0), history }), true);
  assert.equal(readAutoSlot()?.history?.length, 40, "줄인 기록으로 저장된다");
  assert.equal(readAutoSlot()?.sceneId, slotFixture(0).sceneId);
});

test("퀵 세이브는 별도 칸에 저장되고 이어서 읽기 후보에 포함된다", () => {
  installMemoryStorage(); invalidateStorageCache();
  assert.equal(readQuickSlot(), null);
  assert.equal(writeQuickSlot({ ...slotFixture(3), savedAt: 5_000_000 }), true);
  assert.equal(readQuickSlot()?.sceneId, slotFixture(3).sceneId);
  assert.equal(latestSave()?.savedAt, 5_000_000);
  assert.equal(readSlot(3), null, "수동 슬롯은 건드리지 않는다");
});

test("설정은 게임 네임스페이스별로 저장되며 없으면 공용 설정을 이어받는다", () => {
  installMemoryStorage(); invalidateStorageCache();
  writeSettings({ ...defaultSettingsFor(), textSpeed: 5, autoSpeed: 20, muted: true, skipUnread: true });
  const inherited = loadSettings("bundle-0000000000000001");
  assert.equal(inherited.textSpeed, 5); assert.equal(inherited.autoSpeed, 20); assert.equal(inherited.muted, true); assert.equal(inherited.skipUnread, true);
  writeSettings({ ...inherited, textSpeed: 60 }, "bundle-0000000000000001");
  assert.equal(loadSettings("bundle-0000000000000001").textSpeed, 60);
  assert.equal(loadSettings().textSpeed, 5, "공용 설정은 그대로다");
  assert.equal(loadSettings("bundle-0000000000000002").textSpeed, 5, "다른 게임은 공용 설정을 본다");
  // 범위를 벗어난 오토 속도는 잘린다.
  writeSettings({ ...inherited, autoSpeed: 9999 });
  assert.equal(loadSettings().autoSpeed, 150);
});
function defaultSettingsFor() { return { bgmVolume: 0.5, sfxVolume: 0.5, voiceVolume: 0.5, textSpeed: 28 }; }

test("읽은 대사 기억은 씬별로 저장되고 상한을 넘으면 오래된 씬부터 잊는다", () => {
  installMemoryStorage(); invalidateStorageCache();
  assert.equal(readLineKeys().size, 0);
  assert.equal(rememberRead(["s01#0", "s01#intro", "s02#3"]), true);
  assert.deepEqual([...readLineKeys()].sort(), ["s01#0", "s01#intro", "s02#3"]);
  assert.equal(rememberRead(["s01#0"]), true, "중복은 조용히 무시한다");
  assert.equal(readLineKeys("other").size, 0, "네임스페이스는 분리된다");
  const old = Array.from({ length: 30_000 }, (_, i) => `old#${i}`), fresh = Array.from({ length: READ_LIMIT - 30_000 + 1 }, (_, i) => `fresh#${i}`);
  rememberRead(old); rememberRead(fresh);
  const keys = readLineKeys();
  assert.ok(!keys.has("old#0"), "상한을 넘기면 오래된 씬을 잊는다");
  assert.ok(keys.has("fresh#0"));
  assert.ok(keys.size <= READ_LIMIT);
});

test("세이브의 롤백 기록은 검증을 거쳐 읽히고 잘못된 항목은 버린다", () => {
  const store = installMemoryStorage(); invalidateStorageCache();
  store.set("vnmaker:auto", JSON.stringify({ sceneId: "s", lineIndex: 1, affection: 0, savedAt: 1, rollback: [{ sceneId: "s", lineIndex: 0, affection: 0, flags: { score: 1, __proto__: { x: 1 } }, phase: "scene", historyLength: 0 }, { sceneId: "", lineIndex: 0 }, { sceneId: "s", lineIndex: -1 }, "garbage", { sceneId: "s", lineIndex: 2.7, affection: "x", phase: "ending", historyLength: -3 }] }));
  const auto = readAutoSlot();
  assert.deepEqual(auto?.rollback, [{ sceneId: "s", lineIndex: 0, affection: 0, flags: { score: 1 }, phase: "scene", historyLength: 0 }, { sceneId: "s", lineIndex: 2, affection: 0, flags: {}, phase: "scene", historyLength: 0 }]);
});
