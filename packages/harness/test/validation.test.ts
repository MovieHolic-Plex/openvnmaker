import assert from "node:assert/strict";
import test from "node:test";
import { applyChoiceFlags, choiceAllowed, lineAllowed, parseScript, type StoryFlags, type VnScript } from "@vnmaker/content";
import { canonicalJson, countCharacters, parseReviewRecord, validateWorkspace } from "../src/index.js";
import {
  branchingBeats, branchingScript, coveringReview, distinctOutcomes, duplicateEndingScript,
  duplicateBeats, HASH, identicalOutcomes, linearBeats, linearOutcome, linearScript, outlineDocument,
  readyInput, REVIEW_ID,
} from "./validation-fixture.js";

type OraclePath = {
  readonly sceneIds: readonly string[];
  readonly flags: StoryFlags;
  readonly endingTitle: string;
  readonly characterCount: number;
};

function oraclePaths(script: VnScript): readonly OraclePath[] {
  const byId = new Map(script.scenes.map(scene => [scene.id, scene]));
  const queue: {
    readonly id: string; readonly flags: StoryFlags; readonly chars: number;
    readonly scenes: readonly string[];
  }[] = [{ id: script.start, flags: script.flags ?? {}, chars: 0, scenes: [] }];
  const seen = new Set<string>();
  const paths: OraclePath[] = [];
  for (const state of queue) {
    const key = `${state.id}:${canonicalJson(state.flags)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scene = byId.get(state.id);
    if (scene === undefined) continue;
    const lines = scene.lines.filter(line => lineAllowed(line, state.flags));
    const chars = state.chars + lines.reduce((sum, line) => sum + countCharacters(line.text), 0);
    const scenes = [...state.scenes, scene.id];
    if (scene.choices?.length) {
      for (const choice of scene.choices) {
        if (!choiceAllowed(choice, state.flags)) continue;
        queue.push({ id: choice.next, flags: applyChoiceFlags(state.flags, choice), chars, scenes });
      }
      continue;
    }
    if (scene.ending !== undefined) {
      paths.push({ sceneIds: scenes, flags: state.flags, endingTitle: scene.ending, characterCount: chars });
      continue;
    }
    if (scene.next !== undefined) queue.push({ id: scene.next, flags: state.flags, chars, scenes });
  }
  return paths;
}

function byEnding<T extends { readonly endingTitle: string | null }>(paths: readonly T[]): T[] {
  return [...paths].sort((a, b) => (a.endingTitle ?? "").localeCompare(b.endingTitle ?? ""));
}

test("route-duration-and-quality-evidence", () => {
  const script = branchingScript();
  const document = outlineDocument(branchingBeats(), { endingOutcomes: distinctOutcomes() });
  const report = validateWorkspace(readyInput(script, document));
  const oracle = oraclePaths(script);
  assert.equal(oracle.length, 2);
  assert.equal(report.routes.paths.length, oracle.length);
  const expected = byEnding(oracle);
  const actual = byEnding(report.routes.paths);
  for (const [index, path] of expected.entries()) {
    const row = actual[index];
    assert.ok(row);
    assert.equal(row.endingTitle, path.endingTitle);
    assert.equal(row.characterCount, path.characterCount);
    assert.equal(row.estimatedMinutes, path.characterCount / 320);
    assert.deepEqual(row.flags, path.flags);
    assert.deepEqual(row.sceneIds, path.sceneIds);
  }
  assert.equal(report.routes.distinguishing, "conditions-and-dialogue");
  assert.notEqual(expected[0]?.characterCount, expected[1]?.characterCount);
  assert.notDeepEqual(expected[0]?.flags, expected[1]?.flags);
  assert.notEqual(expected[0]?.endingTitle, expected[1]?.endingTitle);
  assert.equal(report.technical.schema, "pass");
  assert.equal(report.technical.graph, "pass");
  assert.equal(report.technical.condition, "pass");
  assert.equal(report.technical.assets, "pass");
  assert.equal(report.technical.runtime, "pass");
  assert.equal(report.gate.technicalGreen, true);
  assert.equal(report.gate.contentPending, false);
  assert.equal(report.content.status, "evaluated");
  assert.equal(report.gate.proposalReady, true);
  const quotaClosed = validateWorkspace({
    ...readyInput(script, document),
    quota: { remainingTextAttempts: 0, remainingImageAttempts: 0 },
  });
  assert.equal(quotaClosed.gate.proposalReady, true);
  assert.deepEqual(quotaClosed.technical, report.technical);
  assert.equal(quotaClosed.content.status, report.content.status);
  assert.deepEqual(quotaClosed.quota, { remainingTextAttempts: 0, remainingImageAttempts: 0 });
});

test("no-false-completion", () => {
  const linear = linearScript();
  const closed = outlineDocument(linearBeats(), { endingOutcomes: linearOutcome() });
  const absent = validateWorkspace({
    ...readyInput(linear, closed), reviews: [], chapterApprovals: [],
  });
  assert.equal(absent.gate.technicalGreen, true);
  assert.equal(absent.gate.contentPending, true);
  assert.equal(absent.content.status, "pending");
  assert.equal(absent.gate.previewEligible, true);
  assert.equal(absent.gate.proposalReady, false);
  assert.ok(absent.gate.blockers.some(row => row.kind === "absent-content-evidence"));

  const unresolved = validateWorkspace({
    ...readyInput(linear, closed), requiredAssetHashes: [HASH], presentAssetHashes: [],
  });
  assert.equal(unresolved.technical.assets, "fail");
  assert.equal(unresolved.gate.proposalReady, false);
  assert.ok(unresolved.gate.blockers.some(row => row.kind === "unresolved-asset"));

  const broken = validateWorkspace(readyInput(linearScript("ghost"), outlineDocument(linearBeats("ghost"), {
    endingOutcomes: linearOutcome(),
  })));
  assert.equal(broken.technical.graph, "fail");
  assert.equal(broken.gate.proposalReady, false);
  assert.ok(broken.gate.blockers.some(row => row.kind === "broken-link"));

  const clones = duplicateEndingScript();
  const duplicate = validateWorkspace(readyInput(clones, outlineDocument(duplicateBeats(), {
    endingOutcomes: identicalOutcomes(),
  })));
  assert.equal(duplicate.routes.distinguishing, "ending-count-only");
  assert.equal(duplicate.gate.proposalReady, false);
  assert.ok(duplicate.gate.blockers.some(row => row.kind === "duplicate-ending"));

  const capped = validateWorkspace({ ...readyInput(branchingScript(), outlineDocument(branchingBeats(), {
    endingOutcomes: distinctOutcomes(),
  })), pathStateBound: 1 });
  assert.equal(capped.routes.complete, false);
  assert.equal(capped.routes.exceededBound, true);
  assert.ok(capped.routes.unverifiedPaths.length > 0);
  assert.equal(capped.gate.proposalReady, false);
  assert.ok(capped.gate.blockers.some(row => row.kind === "path-bound-exceeded"));

  const partial = parseScript({
    title: "Partial", subtitle: "", start: "start", characters: [],
    scenes: [{
      id: "start", chapter: "1", background: "title",
      lines: [{ id: "l-start", speaker: null, text: "Only the first hall is written." }],
      next: "later",
    }],
  });
  const preview = validateWorkspace({
    ...readyInput(partial, outlineDocument([
      { id: "start", chapter: "1", title: "start", summary: "beat", artDirection: "still air", targetMinutes: 1, background: "title", next: "later" },
      { id: "later", chapter: "1", title: "later", summary: "beat", artDirection: "still air", targetMinutes: 1, background: "title", ending: "Later" },
    ])),
    reviews: [], chapterApprovals: [],
  });
  assert.equal(preview.gate.previewEligible, true);
  assert.equal(preview.gate.proposalReady, false);
  assert.ok(preview.gate.blockers.some(row => row.kind === "unwritten-planned"));
});

test("belief-is-not-world-fact", () => {
  const script = linearScript();
  const document = outlineDocument(linearBeats(), {
    endingOutcomes: linearOutcome(),
    worldTimeline: [{
      id: "secret-hope", category: "world-fact", text: "She still has the key.",
      characterIds: [], sceneIds: ["end"], relatedEntryIds: [],
      truth: { kind: "belief", holderCharacterId: "hero" },
    }],
  });
  const report = validateWorkspace(readyInput(script, document));
  assert.ok(report.issues.some(issue => issue.category === "continuity" && issue.severity === "blocking"));
  assert.equal(report.gate.proposalReady, false);
});

test("branch-knowledge-leak", () => {
  const script = parseScript({
    title: "Leak", subtitle: "", start: "start", characters: [], flags: { secret: false },
    scenes: [
      {
        id: "start", chapter: "1", background: "title",
        lines: [{ id: "l-start", speaker: null, text: "A rumor waits." }],
        choices: [
          { id: "c-learn", text: "Learn", next: "merge", set: { secret: true } },
          { id: "c-skip", text: "Skip", next: "merge", set: { secret: false } },
        ],
      },
      {
        id: "merge", chapter: "1", background: "title", ending: "Done",
        lines: [{ id: "l-merge", speaker: null, text: "The hidden key is under the stair." }],
      },
    ],
  });
  const document = outlineDocument([
    {
      id: "start", chapter: "1", title: "start", summary: "beat", artDirection: "still air",
      targetMinutes: 1, background: "title",
      choices: [
        { id: "c-learn", text: "Learn", next: "merge", set: { secret: true } },
        { id: "c-skip", text: "Skip", next: "merge", set: { secret: false } },
      ],
    },
    { id: "merge", chapter: "1", title: "merge", summary: "beat", artDirection: "still air", targetMinutes: 1, background: "title", ending: "Done" },
  ], {
    endingOutcomes: [{
      endingId: "merge", requiredRouteState: { secret: true }, resolution: "Known.",
      cost: "None.", relationshipChanges: [], openThreads: [],
    }],
    branchFacts: [{
      id: "key-place", category: "branch-fact", text: "The hidden key is under the stair.",
      characterIds: [], sceneIds: ["merge"], relatedEntryIds: [],
      applicability: { anyOf: [{ all: ["secret"] }] },
    }],
  });
  const report = validateWorkspace(readyInput(script, document));
  assert.ok(report.issues.some(issue => issue.category === "branch-knowledge"));
  assert.equal(report.gate.proposalReady, false);
});

test("ending-outcome-contract", () => {
  const clones = duplicateEndingScript();
  const titledOnly = validateWorkspace(readyInput(clones, outlineDocument(duplicateBeats(), {
    endingOutcomes: identicalOutcomes(),
  })));
  assert.equal(titledOnly.routes.endingCount, 2);
  assert.equal(titledOnly.routes.distinguishing, "ending-count-only");
  assert.ok(titledOnly.issues.some(issue => issue.category === "route-payoff"));
  assert.equal(titledOnly.gate.proposalReady, false);
  const distinct = validateWorkspace(readyInput(branchingScript(), outlineDocument(branchingBeats(), {
    endingOutcomes: distinctOutcomes(),
  })));
  assert.equal(distinct.routes.distinguishing, "conditions-and-dialogue");
  assert.equal(distinct.gate.proposalReady, true);
});

test("review-coverage-and-disposition", () => {
  const script = linearScript();
  const document = outlineDocument(linearBeats(), { endingOutcomes: linearOutcome() });
  const lastOnly = parseReviewRecord({
    reviewId: REVIEW_ID, candidateDigest: HASH, kind: "chapter",
    scope: {
      chapterIds: ["1"], sceneIds: ["end"], lines: [{ sceneId: "end", lineId: "l-end" }],
      choices: [], assetIds: [],
    },
    coverage: [{ sceneId: "end", lineIds: ["l-end"], hash: HASH }],
    checks: [{
      id: "voice", status: "pass",
      evidence: [{ target: { kind: "line", sceneId: "end", lineId: "l-end" }, sourceHash: HASH, excerpt: "Goodbye now." }],
    }],
    issues: [], disposition: "pass",
  });
  const truncated = validateWorkspace({ ...readyInput(script, document), reviews: [lastOnly] });
  const chapter = truncated.content.chapters[0];
  assert.ok(chapter);
  assert.equal(chapter.coverageComplete, false);
  assert.equal(chapter.disposition, "unverified");
  assert.equal(truncated.content.status, "pending");
  assert.equal(truncated.gate.proposalReady, false);

  const blankPass = parseReviewRecord({
    reviewId: REVIEW_ID, candidateDigest: HASH, kind: "chapter",
    scope: { chapterIds: ["1"], sceneIds: ["start", "end"], lines: [], choices: [], assetIds: [] },
    coverage: [
      { sceneId: "start", lineIds: ["l-start"], hash: HASH },
      { sceneId: "end", lineIds: ["l-end"], hash: HASH },
    ],
    checks: [{ id: "voice", status: "pass", evidence: [] }],
    issues: [], disposition: "pass",
  });
  const absent = validateWorkspace({ ...readyInput(script, document), reviews: [blankPass] });
  assert.equal(absent.content.chapters[0]?.disposition, "unverified");
  assert.equal(absent.content.chapters[0]?.missingEvidence, true);
  assert.notEqual(absent.content.chapters[0]?.disposition, "pass");

  const pixels = validateWorkspace({
    ...readyInput(script, document),
    requiredAssetHashes: [HASH], presentAssetHashes: [HASH],
    assetInspections: [{ hash: HASH, status: "undecodable" }],
  });
  assert.equal(pixels.technical.assets, "unverified");
  assert.notEqual(pixels.technical.assets, "fail");
  assert.notEqual(pixels.technical.assets, "pass");
  assert.equal(pixels.gate.proposalReady, false);

  const blocking = coveringReview(script, "accepted-with-notes");
  const forced = parseReviewRecord({
    ...blocking,
    issues: [{
      id: REVIEW_ID, repairFamilyId: REVIEW_ID, category: "structure", severity: "blocking",
      targets: [{ kind: "scene", sceneId: "start" }],
      evidence: [{ target: { kind: "scene", sceneId: "start" }, sourceHash: HASH, excerpt: "broken" }],
      requestedChange: "Fix the graph.",
    }],
    acceptedNotes: [{ issueId: REVIEW_ID, reason: "ignore" }],
  });
  const notes = validateWorkspace({ ...readyInput(script, document), reviews: [forced] });
  assert.equal(notes.content.chapters[0]?.disposition, "changes-required");
  assert.equal(notes.gate.proposalReady, false);
});
