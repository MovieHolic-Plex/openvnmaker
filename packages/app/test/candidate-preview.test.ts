import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript } from "@vnmaker/content";
import { reduce } from "../src/engine/reducer.js";
import { initialState } from "../src/engine/types.js";
import {
  applyPreviewAction, bootPreview, previewSaveScope, rejectPreviewExport, restorePreviewBoundary,
  scriptFromPreview,
} from "../src/studio/harness/previewBoundary.js";
import type { PreviewSnapshot } from "@vnmaker/harness";

const snapshot = {
  kind: "candidate-preview",
  previewId: "00000000-0000-4000-8000-000000000021",
  projectId: "legacy",
  runId: "00000000-0000-4000-8000-000000000022",
  candidateId: "00000000-0000-4000-8000-000000000023",
  candidateRevision: 1,
  sourceHead: {
    projectId: "legacy", lineageId: "00000000-0000-4000-8000-000000000001",
    revision: 0, scriptHash: "a".repeat(64), productionHash: "b".repeat(64),
  },
  snapshotHash: "c".repeat(64),
  entry: { kind: "from-start", sceneId: "ch01-lab" },
  materializedScenes: [
    { id: "ch01-lab", background: "title", lines: [{ id: "l-a", speaker: null, text: "Lab" }], next: "ch01-exit" },
    {
      id: "ch01-exit", background: "title",
      lines: [{ id: "l-c", speaker: null, text: "Exit" }],
      choices: [{ id: "continue", text: "Go on", next: "ch02-arrival", add: { visits: 1 } }],
    },
  ],
  cast: [],
  initialFlags: { visits: 0 },
  assetBindings: [],
  boundaries: [
    { fromSceneId: "ch01-exit", choiceId: "continue", targetSceneId: "ch02-arrival", reason: "unwritten-scene" },
  ],
  includedUnitHashes: [],
} as const;

function playable() {
  const script = scriptFromPreview(snapshot as PreviewSnapshot, "Preview");
  return { script, play: bootPreview(script, snapshot as PreviewSnapshot) };
}

test("unwritten-choice-has-no-side-effects", () => {
  const { script, play } = playable();
  let next = applyPreviewAction(script, play, { type: "advance" }, snapshot.boundaries);
  next = applyPreviewAction(script, next, { type: "advance" }, snapshot.boundaries);
  assert.equal(next.state.phase, "choice");
  assert.equal(next.state.flags.visits, 0);
  const blocked = applyPreviewAction(script, next, { type: "choose", index: 0 }, snapshot.boundaries);
  assert.equal(blocked.pending?.kind, "choice");
  assert.equal(blocked.state.phase, "choice");
  assert.equal(blocked.state.flags.visits, 0);
  assert.equal(blocked.state.history.filter(row => row.text.includes("Go on")).length, 0);
  const restored = restorePreviewBoundary(blocked);
  assert.equal(restored.pending, null);
  assert.equal(restored.state.phase, "choice");
  assert.equal(restored.state.flags.visits, 0);
});

test("auto-and-skip-stop-at-boundary", () => {
  const script = parseScript({
    title: "Preview", subtitle: "", start: "ch01-lab", characters: [],
    scenes: [
      { id: "ch01-lab", background: "title", lines: [{ speaker: null, text: "Lab" }], next: "ch02-arrival" },
    ],
  });
  const boundaries = [{ fromSceneId: "ch01-lab", targetSceneId: "ch02-arrival", reason: "unwritten-scene" as const }];
  const started = { state: reduce(script, initialState(script), { type: "start" }), pending: null };
  const skipped = applyPreviewAction(script, started, { type: "skipScene" }, boundaries);
  assert.equal(skipped.pending?.kind, "exit");
  assert.equal(skipped.state.phase, "scene");
  assert.equal(skipped.state.error, null);
  assert.equal(skipped.state.history.filter(row => row.text === "Lab").length, 1);
  const advanced = applyPreviewAction(script, started, { type: "advance" }, boundaries);
  assert.equal(advanced.pending?.kind, "exit");
  assert.equal(advanced.state.history.filter(row => row.text === "Lab").length, 1);
});

test("preview-save-isolation-and-export-reject", () => {
  assert.equal(previewSaveScope(snapshot as PreviewSnapshot), `candidate:${snapshot.projectId}:${snapshot.snapshotHash}`);
  assert.equal(rejectPreviewExport().code, "PREVIEW_NOT_RELEASE");
  assert.equal(rejectPreviewExport().ok, false);
});
