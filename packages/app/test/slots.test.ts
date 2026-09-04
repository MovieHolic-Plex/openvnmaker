import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listSlots,
  migrateLegacySave,
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
    thumbnail: `bg-${index}`,
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
  assert.equal(slots[5]?.thumbnail, "bg-5");
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

test("옛날 단일 키(vnmaker:save)는 1번 슬롯으로 이주한다", () => {
  const store = installMemoryStorage();
  store.set(
    LEGACY_KEY,
    JSON.stringify({ sceneId: "s02-old", lineIndex: 3, affection: 5, savedAt: 1699999999000 }),
  );
  assert.equal(readSlot(0), null);
  const migrated = migrateLegacySave();
  assert.ok(migrated !== null);
  assert.equal(migrated?.sceneId, "s02-old");
  assert.equal(migrated?.lineIndex, 3);
  const first = readSlot(0);
  assert.equal(first?.sceneId, "s02-old");
  assert.equal(first?.affection, 5);
  // 슬롯 키에 실제로 기록된다.
  assert.ok(store.has(SLOTS_KEY));
});
