import assert from "node:assert/strict";
import { test } from "node:test";
import type { VnScript } from "@vnmaker/content";
import { generateMedium } from "../../../tests/fixtures/harness/medium.js";
import {
  CONTEXT_SEARCH_LIMIT, createPairMemo, listKeyAction, listWindow, searchManuscriptWindow, windowSlice,
} from "../src/studio/harness/listWindow.js";
import { applyLineOperations, collectProposalDiffWork } from "../src/studio/harness/proposalDiff.js";

function naiveIdenticalCopies(script: VnScript): number {
  let linesCopied = 0;
  for (const scene of script.scenes) {
    for (const line of scene.lines) { linesCopied += 1; void line.text; }
    for (const line of scene.lines) { linesCopied += 1; void line.text; }
  }
  return linesCopied;
}

function firstLineOps(script: VnScript, count: number): readonly { readonly sceneId: string; readonly lineIndex: number; readonly text: string }[] {
  const operations: { readonly sceneId: string; readonly lineIndex: number; readonly text: string }[] = [];
  for (const scene of script.scenes) {
    for (let index = 0; index < scene.lines.length; index++) {
      if (operations.length >= count) return operations;
      operations.push({ sceneId: scene.id, lineIndex: index, text: `patched ${operations.length + 1}` });
    }
  }
  return operations;
}

const medium = generateMedium();
const lineTotal = medium.scenes.reduce((sum, scene) => sum + scene.lines.length, 0);

test("medium-fixture-is-80-by-6000", () => {
  assert.equal(medium.scenes.length, 80);
  assert.equal(lineTotal, 6000);
});

test("naive-identical-diff-copies-every-line", () => {
  const before = naiveIdenticalCopies(medium);
  assert.equal(before, 12000);
});

test("windowed-list-materializes-viewport-not-all-rows", () => {
  const frame = listWindow({
    total: medium.scenes.length, scrollTop: 0, viewportHeight: 360, rowHeight: 40, overscan: 4,
  });
  assert.equal(frame.total, 80);
  assert.ok(frame.visible <= 20);
  assert.ok(frame.visible < frame.total);
  assert.equal(windowSlice(medium.scenes, frame).length, frame.visible);
  const tail = listWindow({
    total: 100, scrollTop: 100 * 72 - 360, viewportHeight: 360, rowHeight: 72, overscan: 4,
  });
  assert.ok(tail.visible <= 20);
  assert.equal(tail.end, 100);
  assert.ok(tail.start > 0);
});

test("optimized-identical-scripts-copy-no-line-text", () => {
  const work = collectProposalDiffWork(medium, medium);
  assert.equal(work.rows.length, 0);
  assert.equal(work.linesCopied, 0);
  assert.equal(work.clonedWholeScript, false);
});

test("hundred-operation-diff-does-not-clone-script", () => {
  const operations = firstLineOps(medium, 100);
  assert.equal(operations.length, 100);
  const patched = applyLineOperations(medium, operations);
  assert.equal(patched.linesCopied, 100);
  assert.equal(patched.scenesCopied, 2);
  assert.equal(patched.clonedWholeScript, false);
  assert.equal(patched.script.scenes[2], medium.scenes[2]);
  assert.equal(patched.script.scenes[1]?.lines[40], medium.scenes[1]?.lines[40]);
  assert.notEqual(patched.script.scenes[0]?.lines[0], medium.scenes[0]?.lines[0]);
  const work = collectProposalDiffWork(medium, patched.script);
  assert.equal(work.rows.length, 100);
  assert.equal(work.linesCopied, 200);
  assert.equal(work.scenesCopied, 2);
  assert.equal(work.clonedWholeScript, false);
  const frame = listWindow({
    total: work.rows.length, scrollTop: 0, viewportHeight: 360, rowHeight: 72, overscan: 4,
  });
  assert.ok(frame.visible <= 20);
  assert.ok(frame.visible < work.rows.length);
});

test("memoized-diff-skips-recompute-on-same-refs", () => {
  const memo = createPairMemo(collectProposalDiffWork);
  const first = memo.run(medium, medium);
  const second = memo.run(medium, medium);
  assert.equal(first, second);
  assert.equal(memo.recomputes(), 1);
  const patched = applyLineOperations(medium, firstLineOps(medium, 1));
  memo.run(medium, patched.script);
  assert.equal(memo.recomputes(), 2);
});

test("context-search-windows-to-forty", () => {
  const work = searchManuscriptWindow(medium, "Synthetic fixture", CONTEXT_SEARCH_LIMIT);
  assert.equal(work.hits.length, 40);
  assert.equal(work.copiedExcerpts, 40);
  assert.ok(work.copiedExcerpts < lineTotal);
  assert.ok(work.scannedScenes <= medium.scenes.length);
  assert.equal(work.truncated, true);
  const empty = searchManuscriptWindow(medium, "   ", CONTEXT_SEARCH_LIMIT);
  assert.equal(empty.copiedExcerpts, 0);
  assert.equal(empty.scannedScenes, 0);
  const unique = searchManuscriptWindow(medium, "s002 line 1.", CONTEXT_SEARCH_LIMIT);
  assert.equal(unique.hits.length, 1);
  assert.equal(unique.copiedExcerpts, 1);
});

test("ime-composition-does-not-move-list-selection", () => {
  const composing = listKeyAction({ key: "ArrowDown", composing: true, selected: 3, total: 80 });
  assert.equal(composing.handled, false);
  assert.equal(composing.selected, 3);
  assert.equal(composing.activate, false);
  const move = listKeyAction({ key: "ArrowDown", composing: false, selected: 3, total: 80 });
  assert.equal(move.handled, true);
  assert.equal(move.selected, 4);
  const enter = listKeyAction({ key: "Enter", composing: false, selected: 4, total: 80 });
  assert.equal(enter.activate, true);
  const blocked = listKeyAction({ key: "Enter", composing: true, selected: 4, total: 80 });
  assert.equal(blocked.activate, false);
});
