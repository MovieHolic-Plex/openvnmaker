import type { Issue } from "./review-contracts.js";
import { DEFAULT_READING_SPEED } from "./production-limits.js";
import { assertNever } from "./primitives.js";
import type {
  CheckStatus, CompletionGate, GateBlocker, WorkspaceValidationInput, WorkspaceValidationReport,
} from "./validation-contracts.js";
import {
  canonIssues, endingIssues, evaluateChapters, knowledgeIssues, repetitionOf, stagingOf,
} from "./validation-content.js";
import { assetTarget, makeIssue, sceneTarget } from "./validation-issues.js";
import { distinguishingOf, routeReports, walkRoutes } from "./validation-routes.js";
import { inspectAssets, technicalCoverage } from "./validation-technical.js";

export type {
  AssetInspection, ChapterEvaluation, CheckStatus, CompletionGate, GateBlocker,
  MissingStaging, QuotaRecord, RepeatedBody, RouteCoverage, RouteDistinguishing, RoutePathReport,
  WorkspaceValidationInput, WorkspaceValidationReport,
} from "./validation-contracts.js";

function plannedIds(input: WorkspaceValidationInput): readonly string[] {
  if (input.plannedSceneIds.length > 0) return input.plannedSceneIds;
  if (input.productionDocument.outline.scenes.length > 0) {
    return input.productionDocument.outline.scenes.map(scene => scene.id);
  }
  return input.script.scenes.map(scene => scene.id);
}

function requiredHashes(input: WorkspaceValidationInput): readonly string[] {
  const bindings = input.productionDocument.referenceBindings.flatMap(row => [row.originalHash, row.deliveryHash]);
  return [...new Set([...input.requiredAssetHashes, ...bindings])];
}

function checkPass(status: CheckStatus): boolean {
  switch (status) {
    case "pass": return true;
    case "fail": case "unverified": return false;
    default: return assertNever(status);
  }
}

function blockersFor(input: {
  readonly technical: WorkspaceValidationReport["technical"];
  readonly missing: readonly string[];
  readonly broken: readonly { readonly sceneId: string; readonly target: string }[];
  readonly distinguishing: WorkspaceValidationReport["routes"]["distinguishing"];
  readonly unverifiedPaths: readonly string[];
  readonly exceeded: boolean;
  readonly unwritten: readonly string[];
  readonly chapters: WorkspaceValidationReport["content"]["chapters"];
  readonly issues: readonly Issue[];
}): readonly GateBlocker[] {
  const blockers: GateBlocker[] = [];
  for (const check of ["schema", "graph", "condition", "assets", "runtime"] as const) {
    if (input.technical[check] === "fail") blockers.push({ kind: "technical", check });
  }
  for (const hash of input.missing) blockers.push({ kind: "unresolved-asset", hash });
  for (const link of input.broken) blockers.push({ kind: "broken-link", sceneId: link.sceneId, target: link.target });
  if (input.distinguishing === "ending-count-only") {
    blockers.push({ kind: "duplicate-ending", titles: [] });
  }
  if (input.exceeded) blockers.push({ kind: "path-bound-exceeded", unverifiedPaths: input.unverifiedPaths });
  if (input.unwritten.length > 0) blockers.push({ kind: "unwritten-planned", sceneIds: input.unwritten });
  for (const chapter of input.chapters) {
    if (chapter.disposition === "unverified" || chapter.reviewId === null) {
      blockers.push({ kind: "absent-content-evidence", chapterId: chapter.chapterId });
    }
    if (!chapter.approved) blockers.push({ kind: "chapter-unapproved", chapterId: chapter.chapterId });
  }
  const open = input.issues.filter(issue => issue.severity !== "note").map(issue => issue.id);
  if (open.length > 0) blockers.push({ kind: "changes-required", issueIds: open });
  return blockers;
}

export function validateWorkspace(input: WorkspaceValidationInput): WorkspaceValidationReport {
  const charsPerMinute = input.charsPerMinute ?? DEFAULT_READING_SPEED;
  const bound = input.pathStateBound ?? 10_000;
  const planned = plannedIds(input);
  const plannedSet = new Set(planned);
  const written = new Set(input.script.scenes.map(scene => scene.id));
  const unwritten = planned.filter(id => !written.has(id));
  const walk = walkRoutes(input.script, plannedSet, bound);
  const paths = routeReports(walk, charsPerMinute);
  const distinguishing = distinguishingOf(paths);
  const assets = inspectAssets(requiredHashes(input), input.presentAssetHashes, input.assetInspections);
  const technical = technicalCoverage(input.script, walk, plannedSet, assets);
  const { chapters, reviews } = evaluateChapters(
    input.script, input.productionDocument, input.reviews, new Set(input.chapterApprovals ?? []),
  );
  const issues: Issue[] = [
    ...walk.brokenLinks.map(link => makeIssue(
      `broken:${link.sceneId}:${link.target}`, "structure", "blocking",
      [sceneTarget(link.sceneId)],
      "Repair the broken scene link.",
      link.target,
    )),
    ...assets.missing.map(hash => makeIssue(
      `asset:${hash}`, "required-asset", "blocking",
      [assetTarget(hash)],
      "Required asset bytes are missing.",
    )),
    ...canonIssues(input.productionDocument),
    ...knowledgeIssues(input.script, input.productionDocument, walk.paths),
    ...endingIssues(input.productionDocument, paths),
    ...reviews.flatMap(review => review.issues),
  ];
  const contentPending = chapters.some(chapter => chapter.disposition === "unverified" || chapter.reviewId === null);
  const technicalGreen = checkPass(technical.schema) && checkPass(technical.graph)
    && checkPass(technical.condition) && checkPass(technical.assets) && checkPass(technical.runtime);
  const blockers = blockersFor({
    technical, missing: assets.missing, broken: walk.brokenLinks, distinguishing,
    unverifiedPaths: walk.unverifiedPaths, exceeded: walk.exceededBound, unwritten, chapters, issues,
  });
  const approved = chapters.length > 0 && chapters.every(chapter => (
    chapter.approved && (chapter.disposition === "pass" || chapter.disposition === "accepted-with-notes")
  ));
  const gate: CompletionGate = {
    technicalGreen,
    contentPending,
    previewEligible: technical.schema === "pass" && technical.graph !== "fail" && written.size > 0,
    proposalReady: technicalGreen && !contentPending && approved && unwritten.length === 0
      && !walk.exceededBound && distinguishing !== "ending-count-only"
      && issues.every(issue => issue.severity === "note"),
    blockers,
  };
  const quota = input.quota ?? null;
  return {
    technical, requiredAssetsMissing: assets.missing,
    routes: {
      complete: !walk.exceededBound, exceededBound: walk.exceededBound,
      unverifiedPaths: walk.unverifiedPaths, paths, endingCount: new Set(paths.map(path => path.endingId)).size,
      distinguishing,
    },
    repetition: repetitionOf(input.script), missingStaging: stagingOf(input.script),
    content: { status: contentPending ? "pending" : "evaluated", chapters },
    reviews, issues, gate, quota,
    compact: {
      schema: technical.schema === "pass",
      graph: technical.graph === "pass" && unwritten.length === 0,
      assets: technical.assets === "pass",
      runtime: technical.runtime === "pass",
      requiredAssetsMissing: assets.missing, issues,
      reviewIds: reviews.map(review => review.reviewId),
    },
    writtenSceneCount: written.size, plannedSceneCount: planned.length,
  };
}
