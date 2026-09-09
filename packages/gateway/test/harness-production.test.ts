import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashSchema, parseOutline, restoreProduction, PRODUCTION_SCENE_LIMITS, PRODUCTION_MINUTE_LIMITS,
} from "../../harness/src/index.js";
import type { Unit } from "../../harness/src/index.js";
import {
  authorizeUnitKind, approveChapter, approvePlan, approveReferenceArt, completeUnit,
  createProductionSession, executableUnitIds, previewEligibleSceneIds, proposalGate,
  publicApplyDecision, publicExportDecision, registerApprovedCast, rejectChapter,
  startSelectionRepair,
} from "../src/harness/production.js";
import type { ProductionSession } from "../src/harness/production.js";
import {
  HASH, makeRunner, recordingDispatch, sequentialIds, startCommand, waitForState,
} from "./harness-runner-fixtures.js";
import {
  CAST_DRAFTS, LIGHTHOUSE_BRIEF, SOURCE_HEAD, draftFromBeat, labelHasher, linearBeats,
  partialBeats, pendingHarnessUnit, placeholderScene, productionRun, sessionIds, sixChapterBeats,
  twentySceneWork,
} from "./harness-production-fixtures.js";

function emptyPlanSession(): ProductionSession {
  return createProductionSession({
    sourceHead: SOURCE_HEAD, initialScope: "plan", brief: LIGHTHOUSE_BRIEF, targetMinutes: 180,
    hasher: labelHasher(), ids: sessionIds(), scriptScenes: [placeholderScene()], scriptCast: [],
  });
}

function leaksSampleUniversity(session: ProductionSession): boolean {
  return /서린|대학생|campus-gate|유리 바다/.test(JSON.stringify({
    scenes: session.scenes, beats: session.beats, brief: session.brief, cast: session.cast,
  }));
}

function toHarnessUnits(session: ProductionSession): readonly Unit[] {
  return session.units.map(unit => pendingHarnessUnit(unit.id, unit.kind, unit.dependencyHashes));
}

function completeScope(session: ProductionSession, chapterId: string, speaker: string): ProductionSession {
  let next = session;
  for (;;) {
    const ids = executableUnitIds(next).filter(id => {
      const unit = next.units.find(row => row.id === id);
      if (unit === undefined) return false;
      if (chapterId === "plan") return unit.kind === "outline";
      return unit.chapterId === chapterId;
    });
    if (ids.length === 0) return next;
    for (const unitId of ids) {
      const unit = next.units.find(row => row.id === unitId);
      if (unit === undefined) continue;
      const beat = next.beats.find(row => row.id === unit.sceneId);
      const scene = unit.kind === "scene-draft" && beat !== undefined ? draftFromBeat(beat, speaker) : undefined;
      next = completeUnit(next, unitId, {
        hash: next.hasher.hash(`unit:${unitId}`),
        ...(scene === undefined ? {} : { scene }),
      });
    }
  }
}

test("approved-outline-to-closed-proposal honors approvals and predecessor hashes", async () => {
  let session = emptyPlanSession();
  assert.equal(authorizeUnitKind(session, "scene-draft"), false);
  assert.equal(authorizeUnitKind(session, "image"), false);
  session = registerApprovedCast(session, CAST_DRAFTS);
  assert.equal(session.cast.length, 6);
  const source = session.sourceHead;
  session = approvePlan(session, { beats: sixChapterBeats(), hash: HASH.c });
  assert.deepEqual(session.sourceHead, source);
  assert.equal(authorizeUnitKind(session, "scene-draft"), true);
  assert.equal(authorizeUnitKind(session, "image"), true);
  session = approveReferenceArt(session, { assetId: "lighthouse-ref", hash: HASH.d });
  assert.deepEqual(session.sourceHead, source);

  const runnerIds = sequentialIds(200);
  const dispatch = recordingDispatch({
    reply: async (request) => {
      if (!session.planApproved && (request.kind === "scene-draft" || request.kind === "image")) {
        return { kind: "known-failed", code: "REVIEW_REQUIRED" };
      }
      return {
        kind: "succeeded",
        artifact: {
          artifactId: request.effectId,
          hash: hashSchema.parse(session.hasher.hash(`unit:${request.unitId}`)),
          bytes: 8,
        },
        usage: { knownInputUsage: 4, knownOutputUsage: 4 },
      };
    },
  });
  const { runner } = makeRunner({ dispatch, ids: runnerIds });
  const created = await runner.create(runnerIds.uuid(), productionRun(toHarnessUnits(session), runnerIds.uuid()));
  const outline = session.units.find(unit => unit.kind === "outline");
  assert.ok(outline);
  const running = waitForState(runner, run => run.state.status === "running");
  await runner.apply(created.id, startCommand(created, [outline.id], runnerIds.uuid()));
  await running;
  assert.equal((await runner.pump(created.id)).stopReason, "unit-ready");
  session = completeUnit(session, outline.id, { hash: session.hasher.hash(`unit:${outline.id}`) });
  const speaker = session.cast[0]?.id;
  assert.ok(speaker);
  const chapters = ["ch01", "ch02", "ch03", "ch04", "ch05", "ch06"];
  for (const [index, chapterId] of chapters.entries()) {
    session = completeScope(session, chapterId, speaker);
    const drafts = session.units.filter(unit => unit.chapterId === chapterId && unit.kind === "scene-draft");
    assert.ok(drafts.length > 0);
    assert.ok(drafts.every(unit => unit.status === "ready" && unit.provenance !== undefined));
    const predecessor = index === 0
      ? session.units.find(unit => unit.kind === "outline")
      : session.units.find(unit => unit.kind === "validation" && unit.chapterId === chapters[index - 1]);
    assert.ok(predecessor?.status === "ready" && predecessor.outputHash !== undefined);
    for (const unit of drafts) assert.ok(unit.dependencyHashes.includes(predecessor.outputHash));
    session = approveChapter(session, chapterId, session.hasher.hash(`chapter:${chapterId}`));
    assert.deepEqual(session.sourceHead, source);
  }
  assert.equal(proposalGate(session).kind, "ready");
  assert.equal(publicApplyDecision(session).ok, true);
  assert.equal(publicExportDecision(session).ok, true);
  assert.deepEqual(session.sourceHead, source);
  assert.equal(leaksSampleUniversity(session), false);
  assert.ok(session.scenes.every(scene => scene.lines.every(line =>
    line.speaker === null || line.speaker === "me" || session.cast.some(member => member.id === line.speaker))));
  assert.equal(dispatch.unitIds[0], outline.id);
});

test("partial-chapter-is-not-a-complete-game refuses apply/export and invalidates downstream", () => {
  let session = registerApprovedCast(emptyPlanSession(), CAST_DRAFTS);
  session = approvePlan(session, { beats: partialBeats(), hash: HASH.c });
  const speaker = session.cast[0]?.id;
  assert.ok(speaker);
  const outline = session.units.find(unit => unit.kind === "outline");
  assert.ok(outline);
  session = completeUnit(session, outline.id, { hash: session.hasher.hash(`unit:${outline.id}`) });
  session = completeScope(session, "ch01", speaker);
  session = approveChapter(session, "ch01", session.hasher.hash("chapter:ch01"));
  const preview = previewEligibleSceneIds(session);
  assert.ok(preview.includes("ch01-s1"));
  assert.ok(!preview.includes("ch02-arrival"));
  assert.equal(proposalGate(session).kind, "blocked");
  if (proposalGate(session).kind === "blocked") {
    assert.equal(proposalGate(session).reason, "unwritten-planned-target");
  }
  assert.equal(publicApplyDecision(session).ok, false);
  assert.equal(publicExportDecision(session).ok, false);
  const ch02 = session.units.filter(unit => unit.chapterId === "ch02");
  assert.ok(ch02.length > 0);
  session = rejectChapter(session, "ch01");
  const after = session.units.filter(unit => unit.chapterId === "ch02");
  assert.ok(after.every(unit => unit.status === "blocked"));
  const kept = session.units.filter(unit => unit.chapterId === "ch01" && unit.kind === "scene-draft");
  assert.ok(kept.every(unit => unit.status === "ready" && unit.provenance !== undefined));
  assert.deepEqual(session.sourceHead, SOURCE_HEAD);
});

test("existing-selection-does-not-replan-game", () => {
  const speaker = "hero1";
  const work = twentySceneWork(speaker);
  const originalScenes = structuredClone(work.scenes);
  const originalBeats = structuredClone(work.beats);
  let session = createProductionSession({
    sourceHead: SOURCE_HEAD, initialScope: "edit", brief: "두 줄만 보강한다.", targetMinutes: 90,
    hasher: labelHasher(), ids: sessionIds(), scriptScenes: work.scenes, scriptCast: [
      { id: speaker, name: "은하", color: "#88aaff", bio: "등대 지기" },
    ], beats: work.beats, selection: { sceneId: "scene_0", lineIds: ["scene_0-l1", "scene_0-l2"] },
  });
  assert.equal(session.units.some(unit => unit.kind === "outline"), false);
  assert.deepEqual(session.beats, originalBeats);
  session = startSelectionRepair(session, {
    sceneId: "scene_0", lineIds: ["scene_0-l1", "scene_0-l2"], instruction: "동기와 연출을 보강한다.",
  });
  const repairs = session.units.filter(unit => unit.kind === "scene-repair");
  const repair = repairs[0];
  assert.ok(repair);
  assert.throws(() => completeUnit(session, repair.id, {
    hash: session.hasher.hash("pad"),
    lines: [
      { id: "scene_0-l1", speaker, text: "scene_0 동기의 첫 줄.scene_0 동기의 첫 줄." },
      { id: "scene_0-l2", speaker: null, text: "scene_0 연출의 둘째 줄." },
    ],
  }), /사건·동기·연출/);
  session = completeUnit(session, repair.id, {
    hash: session.hasher.hash("repair"),
    lines: [
      { id: "scene_0-l1", speaker, text: "등대를 포기하면 항로가 죽는다는 동기가 흔들린다." },
      { id: "scene_0-l2", speaker: null, text: "찬 조명이 렌즈 가장자리만 남기고 사라진다." },
    ],
  });
  assert.deepEqual(session.beats, originalBeats);
  assert.equal(session.scenes.length, 20);
  for (const scene of originalScenes) {
    const current = session.scenes.find(row => row.id === scene.id);
    assert.ok(current);
    if (scene.id === "scene_0") {
      assert.notDeepEqual(current.lines, scene.lines);
      continue;
    }
    assert.deepEqual(current, scene);
  }
  assert.equal(session.units.some(unit => unit.kind === "outline"), false);
});

test("initialScope imported-draft waits for fresh review", async () => {
  const session = createProductionSession({
    sourceHead: SOURCE_HEAD, initialScope: "imported-draft", brief: LIGHTHOUSE_BRIEF, targetMinutes: 180,
    hasher: labelHasher(), ids: sessionIds(), scriptScenes: [placeholderScene()], scriptCast: [],
    importedArchiveHash: HASH.e, beats: sixChapterBeats(),
  });
  assert.equal(session.planApproved, false);
  assert.equal(authorizeUnitKind(session, "scene-draft"), false);
  assert.equal(authorizeUnitKind(session, "image"), false);
  assert.deepEqual(executableUnitIds(session), []);
  assert.equal(proposalGate(session).kind, "blocked");
  if (proposalGate(session).kind === "blocked") assert.equal(proposalGate(session).reason, "imported-review");
  const runnerIds = sequentialIds(240);
  const dispatch = recordingDispatch();
  const { runner } = makeRunner({ dispatch, ids: runnerIds });
  const created = await runner.create(runnerIds.uuid(), productionRun([], runnerIds.uuid()));
  assert.equal(created.state.status, "idle");
  const step = await runner.pump(created.id);
  assert.equal(step.dispatched, 0);
  assert.equal(dispatch.calls, 0);
  assert.deepEqual(session.sourceHead, SOURCE_HEAD);
});

test("parseOutline accepts 40-80 scenes and restore accepts 180-300 minutes", () => {
  const forty = parseOutline({
    title: "등대", subtitle: "중형", bible: "승인된 등대 설정만 사용한다.", start: "scene_0",
    scenes: linearBeats(40, 4.5, "등대"),
  }, 180);
  assert.equal(forty.scenes.length, 40);
  assert.equal(PRODUCTION_SCENE_LIMITS.max, 80);
  const eighty = parseOutline({
    title: "등대", subtitle: "중형", bible: "승인된 등대 설정만 사용한다.", start: "scene_0",
    scenes: linearBeats(80, 2.25, "등대"),
  }, 180);
  assert.equal(eighty.scenes.length, 80);
  const restored = restoreProduction({
    version: 1, id: "plan-medium", baseFingerprint: "fp", baseTitle: "등대",
    characters: [{ id: "hero1", name: "은하", color: "#88aaff", bio: "등대 지기" }],
    brief: LIGHTHOUSE_BRIEF, targetMinutes: 300, charsPerMinute: 320,
    outline: { title: "등대", subtitle: "중형", bible: "승인된 등대 설정만 사용한다.", start: "scene_0", scenes: linearBeats(60, 5, "등대") },
    jobs: Object.fromEntries(linearBeats(60, 5, "등대").map(scene => [scene.id, { status: "pending" }])),
    createdAt: 1,
  }, { now: () => 1, id: () => "plan-medium" });
  assert.equal(restored.targetMinutes, 300);
  assert.ok(restored.targetMinutes <= PRODUCTION_MINUTE_LIMITS.max);
});
