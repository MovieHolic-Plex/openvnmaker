import assert from "node:assert/strict";
import { test } from "node:test";
import type { VnScript } from "@vnmaker/content";
import { studioPreviewBoot } from "../src/previewBoot.js";

function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  let writes = 0;
  const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: key => map.get(key) ?? null,
    setItem: () => {
      writes += 1;
      throw new Error("preview boot must not write storage");
    },
    removeItem: () => {
      writes += 1;
      throw new Error("preview boot must not write storage");
    },
  };
  return { storage, map, writes: () => writes };
}

const fallback: VnScript = {
  title: "기본 작품",
  subtitle: "",
  start: "title-start",
  characters: [],
  scenes: [{ id: "title-start", background: "title", lines: [{ speaker: null, text: "표지" }], ending: "끝" }],
};

const validPreview = {
  title: "미리보기 원고",
  subtitle: "",
  start: "one",
  flags: { seen: false },
  characters: [{ id: "seorin", name: "한서린", color: "#c4554a", bio: "" }],
  scenes: [
    { id: "one", background: "title", lines: [{ speaker: null, text: "하나" }], next: "two" },
    { id: "two", background: "title", lines: [{ speaker: null, text: "둘" }], ending: "끝" },
  ],
};

test("isStudioPreview false with a seeded previewScript still returns fallback and phase title", () => {
  const { storage } = memory({ "vnmaker.previewScript": JSON.stringify(validPreview) });
  const boot = studioPreviewBoot(false, fallback, storage);
  assert.equal(boot.script, fallback);
  assert.equal(boot.script.title, "기본 작품");
  assert.equal(boot.state.phase, "title");
  assert.equal(boot.state.sceneId, "title-start");
  assert.equal(boot.state.sceneEpoch, 0);
});

test("missing previewScript returns fallback title", () => {
  const { storage } = memory();
  const boot = studioPreviewBoot(true, fallback, storage);
  assert.equal(boot.script, fallback);
  assert.equal(boot.state.phase, "title");
  assert.equal(boot.state.sceneId, "title-start");
});

test("previewScript 'old' (parse failure) returns fallback title", () => {
  const { storage } = memory({ "vnmaker.previewScript": "old" });
  const boot = studioPreviewBoot(true, fallback, storage);
  assert.equal(boot.script, fallback);
  assert.equal(boot.state.phase, "title");
  assert.equal(boot.script.title, "기본 작품");
});

test("valid preview {start:'one',...} returns parsed script, phase scene, sceneId one, not fallback.title", () => {
  const { storage, writes } = memory({ "vnmaker.previewScript": JSON.stringify(validPreview) });
  const boot = studioPreviewBoot(true, fallback, storage);
  assert.equal(boot.script.title, "미리보기 원고");
  assert.notEqual(boot.script.title, fallback.title);
  assert.equal(boot.state.phase, "scene");
  assert.equal(boot.state.sceneId, "one");
  assert.equal(boot.state.lineIndex, 0);
  assert.equal(boot.state.sceneEpoch, 1);
  assert.equal(writes(), 0);
});

test("previewPosition {sceneId:'two', lineIndex:0} after valid script restores scene two without staying on start", () => {
  const { storage } = memory({
    "vnmaker.previewScript": JSON.stringify(validPreview),
    "vnmaker.previewPosition": JSON.stringify({ sceneId: "two", lineIndex: 0, flags: { seen: true } }),
  });
  const boot = studioPreviewBoot(true, fallback, storage);
  assert.equal(boot.script.title, "미리보기 원고");
  assert.equal(boot.state.phase, "scene");
  assert.equal(boot.state.sceneId, "two");
  assert.equal(boot.state.lineIndex, 0);
  assert.equal(boot.state.flags.seen, true);
  assert.equal(boot.state.sceneEpoch, 2);
});

test("valid script with malformed position keeps started preview instead of bundled title", () => {
  const { storage } = memory({
    "vnmaker.previewScript": JSON.stringify(validPreview),
    "vnmaker.previewPosition": "{not-json",
  });
  const boot = studioPreviewBoot(true, fallback, storage);
  assert.equal(boot.script.title, "미리보기 원고");
  assert.equal(boot.state.phase, "scene");
  assert.equal(boot.state.sceneId, "one");
  assert.equal(boot.state.sceneEpoch, 1);
});

test("does not read or write localStorage edition/recovery keys", () => {
  const original = {
    "vnmaker.edition": "keep-edition",
    "vnmaker.studio.project.v1": "manuscript",
    "vnmaker.studio.production.v1": "versions",
    "vnmaker.studio.position.v1": "position",
    "vnmaker.studio.art-recovery.v1": "receipts",
    "vnmaker:save": "play-save",
  };
  const local = memory(original);
  const session = memory({ "vnmaker.previewScript": JSON.stringify(validPreview) });
  const previous = (globalThis as { localStorage?: Storage }).localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local.storage });
  try {
    const boot = studioPreviewBoot(true, fallback, session.storage);
    assert.equal(boot.state.sceneId, "one");
    assert.equal(local.writes(), 0);
    for (const [key, value] of Object.entries(original)) assert.equal(local.map.get(key), value);
  } finally {
    if (previous === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
  }
});
