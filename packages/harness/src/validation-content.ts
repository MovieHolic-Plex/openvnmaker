import { lineAllowed } from "../../content/src/index.js";
import type { StoryFlags, VnScript } from "../../content/src/index.js";
import { canonicalJson } from "./canonical.js";
import type { Issue, ReviewDisposition, ReviewRecord } from "./review-contracts.js";
import type { ProductionDocument } from "./production-contracts.js";
import { makeIssue, sceneTarget } from "./validation-issues.js";
import type { ChapterEvaluation, MissingStaging, RepeatedBody, RoutePathReport } from "./validation-contracts.js";
import type { WalkedPath } from "./validation-routes.js";

function holds(condition: {
  readonly all?: readonly string[] | undefined;
  readonly none?: readonly string[] | undefined;
  readonly compare?: readonly { readonly flag: string; readonly op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; readonly value: string | number | boolean }[] | undefined;
}, flags: StoryFlags): boolean {
  return lineAllowed({
    when: {
      ...(condition.all === undefined ? {} : { all: condition.all }),
      ...(condition.none === undefined ? {} : { none: condition.none }),
      ...(condition.compare === undefined ? {} : { compare: condition.compare }),
    },
  }, flags);
}

export function canonIssues(document: ProductionDocument): readonly Issue[] {
  const issues: Issue[] = [];
  for (const entry of document.worldTimeline) {
    if (entry.truth?.kind === "belief") {
      issues.push(makeIssue(
        `belief-world:${entry.id}`, "continuity", "blocking",
        [{ kind: "canon", sectionId: "worldTimeline", entryId: entry.id }],
        "Belief cannot be recorded as a world fact.",
        entry.text,
      ));
    }
  }
  return issues;
}

export function knowledgeIssues(script: VnScript, document: ProductionDocument, paths: readonly WalkedPath[]): readonly Issue[] {
  const byId = new Map(script.scenes.map(scene => [scene.id, scene]));
  const issues: Issue[] = [];
  for (const entry of document.branchFacts) {
    const anyOf = entry.applicability?.anyOf;
    if (anyOf === undefined) continue;
    for (const sceneId of entry.sceneIds) {
      const scene = byId.get(sceneId);
      if (scene === undefined) continue;
      const unconditional = scene.lines.some(line => line.when === undefined);
      if (!unconditional) continue;
      const leaked = paths.some(path => path.sceneIds.includes(sceneId) && !anyOf.some(condition => holds(condition, path.flags)));
      if (!leaked) continue;
      issues.push(makeIssue(
        `leak:${entry.id}:${sceneId}`, "branch-knowledge", "repair",
        [sceneTarget(sceneId)],
        "Branch-only knowledge is used without its condition.",
        entry.text,
      ));
    }
  }
  return issues;
}

export function endingIssues(
  document: ProductionDocument,
  paths: readonly RoutePathReport[],
): readonly Issue[] {
  const outcomes = document.outline.endingOutcomes ?? [];
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path.endingId === null) continue;
    if (seen.has(path.endingId)) continue;
    seen.add(path.endingId);
    const outcome = outcomes.find(row => row.endingId === path.endingId);
    if (outcome === undefined) {
      issues.push(makeIssue(
        `ending-missing:${path.endingId}`, "route-payoff", "repair",
        [sceneTarget(path.endingId)],
        "Each ending needs an outcome contract.",
        path.endingTitle ?? path.endingId,
      ));
      continue;
    }
    if (canonicalJson(outcome.requiredRouteState) !== canonicalJson(path.flags)) {
      issues.push(makeIssue(
        `ending-state:${path.endingId}`, "route-payoff", "repair",
        [sceneTarget(path.endingId)],
        "Ending requiredRouteState must match the path flags.",
      ));
    }
  }
  const fingerprints = outcomes.map(row => canonicalJson({
    requiredRouteState: row.requiredRouteState, resolution: row.resolution,
    cost: row.cost, relationshipChanges: row.relationshipChanges, openThreads: row.openThreads,
  }));
  if (outcomes.length > 1 && new Set(fingerprints).size === 1) {
    const first = outcomes[0];
    if (first !== undefined) {
      issues.push(makeIssue(
        "ending-clone", "route-payoff", "blocking",
        [sceneTarget(first.endingId)],
        "Different ending titles are not a distinguishing outcome.",
      ));
    }
  }
  return issues;
}

export function repetitionOf(script: VnScript): readonly RepeatedBody[] {
  const groups = new Map<string, { readonly text: string; sceneIds: string[] }>();
  for (const scene of script.scenes) {
    for (const line of scene.lines) {
      const text = line.text.replace(/\s/gu, "");
      if (text.length === 0) continue;
      const group = groups.get(text);
      if (group === undefined) groups.set(text, { text: line.text, sceneIds: [scene.id] });
      else group.sceneIds.push(scene.id);
    }
  }
  return [...groups.values()]
    .filter(group => group.sceneIds.length > 1)
    .map(group => ({ text: group.text, occurrences: group.sceneIds.length, sceneIds: group.sceneIds }));
}

export function stagingOf(script: VnScript): readonly MissingStaging[] {
  const missing: MissingStaging[] = [];
  for (const scene of script.scenes) {
    const gaps: MissingStaging["missing"][number][] = [];
    if (scene.artBrief === undefined) gaps.push("artBrief");
    if (scene.sprites === undefined && scene.lines.every(line => line.sprites === undefined)) gaps.push("sprites");
    if (scene.backgroundUrl === undefined && scene.lines.every(line => line.backgroundUrl === undefined)) gaps.push("background");
    if (scene.cgUrl === undefined && scene.lines.every(line => line.cgUrl === undefined)) gaps.push("cg");
    if (gaps.length === 4) missing.push({ sceneId: scene.id, missing: gaps });
  }
  return missing;
}

function coveredKeys(review: ReviewRecord): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const window of review.coverage) {
    for (const lineId of window.lineIds) keys.add(`${window.sceneId}:${lineId}`);
  }
  for (const line of review.scope.lines) keys.add(`${line.sceneId}:${line.lineId}`);
  return keys;
}

function requiredLineKeys(script: VnScript, sceneIds: ReadonlySet<string>): readonly string[] {
  const keys: string[] = [];
  for (const scene of script.scenes) {
    if (!sceneIds.has(scene.id)) continue;
    for (const line of scene.lines) {
      if (line.id === undefined) return [];
      keys.push(`${scene.id}:${line.id}`);
    }
  }
  return keys;
}

function effectiveDisposition(
  review: ReviewRecord,
  coverageComplete: boolean,
  missingEvidence: boolean,
): ReviewDisposition {
  if (!coverageComplete || missingEvidence) return "unverified";
  if (review.issues.some(issue => issue.severity === "blocking")) return "changes-required";
  if (review.disposition === "accepted-with-notes" && review.issues.some(issue => issue.severity === "blocking")) {
    return "changes-required";
  }
  return review.disposition;
}

export function evaluateChapters(
  script: VnScript,
  document: ProductionDocument,
  reviews: readonly ReviewRecord[],
  approvals: ReadonlySet<string>,
): { readonly chapters: readonly ChapterEvaluation[]; readonly reviews: readonly ReviewRecord[] } {
  const chapterScenes = new Map<string, string[]>();
  for (const beat of document.outline.scenes) {
    const written = script.scenes.some(scene => scene.id === beat.id);
    if (!written) continue;
    const rows = chapterScenes.get(beat.chapter) ?? [];
    rows.push(beat.id);
    chapterScenes.set(beat.chapter, rows);
  }
  for (const scene of script.scenes) {
    const chapter = scene.chapter ?? scene.id;
    if (chapterScenes.has(chapter)) continue;
    chapterScenes.set(chapter, [scene.id]);
  }
  const evaluated: ReviewRecord[] = [];
  const chapters: ChapterEvaluation[] = [];
  for (const [chapterId, sceneIds] of chapterScenes) {
    const review = reviews.find(row => row.kind === "chapter" && (
      row.scope.chapterIds.includes(chapterId) || row.scope.sceneIds.some(id => sceneIds.includes(id))
    ));
    const required = requiredLineKeys(script, new Set(sceneIds));
    const covered = review === undefined ? new Set<string>() : coveredKeys(review);
    const coverageComplete = required.length > 0 && required.every(key => covered.has(key));
    const missingEvidence = review === undefined
      || review.checks.some(check => check.status !== "unverified" && check.evidence.length === 0)
      || review.issues.some(issue => issue.evidence.length === 0);
    const disposition: ReviewDisposition = review === undefined
      ? "unverified"
      : effectiveDisposition(review, coverageComplete, missingEvidence);
    if (review !== undefined) evaluated.push({ ...review, disposition });
    chapters.push({
      chapterId, sceneIds, reviewId: review?.reviewId ?? null, coverageComplete, missingEvidence,
      disposition, approved: approvals.has(chapterId),
    });
  }
  return { chapters, reviews: evaluated };
}
