import type { StoryFlags, VnScript } from "../../content/src/index.js";
import type { ProductionDocument } from "./production-contracts.js";
import type { Issue, ReviewDisposition, ReviewRecord, ValidationReport } from "./review-contracts.js";

export type CheckStatus = "pass" | "fail" | "unverified";
export type RouteDistinguishing = "conditions-and-dialogue" | "ending-count-only" | "none";
export type AssetInspectionStatus = "decoded" | "undecodable" | "missing";

export type AssetInspection = {
  readonly hash: string;
  readonly status: AssetInspectionStatus;
};

export type QuotaRecord = {
  readonly remainingTextAttempts: number;
  readonly remainingImageAttempts: number;
};

export type WorkspaceValidationInput = {
  readonly script: VnScript;
  readonly productionDocument: ProductionDocument;
  readonly reviews: readonly ReviewRecord[];
  readonly requiredAssetHashes: readonly string[];
  readonly presentAssetHashes: readonly string[];
  readonly assetInspections: readonly AssetInspection[];
  readonly plannedSceneIds: readonly string[];
  readonly charsPerMinute?: number;
  readonly pathStateBound?: number;
  readonly chapterApprovals?: readonly string[];
  readonly quota?: QuotaRecord | null;
};

export type RoutePathReport = {
  readonly pathId: string;
  readonly sceneIds: readonly string[];
  readonly flags: StoryFlags;
  readonly endingId: string | null;
  readonly endingTitle: string | null;
  readonly characterCount: number;
  readonly estimatedMinutes: number | null;
  readonly dialogueFingerprint: string;
  readonly outcomeFingerprint: string;
};

export type RouteCoverage = {
  readonly complete: boolean;
  readonly exceededBound: boolean;
  readonly unverifiedPaths: readonly string[];
  readonly paths: readonly RoutePathReport[];
  readonly endingCount: number;
  readonly distinguishing: RouteDistinguishing;
};

export type RepeatedBody = {
  readonly text: string;
  readonly occurrences: number;
  readonly sceneIds: readonly string[];
};

export type MissingStaging = {
  readonly sceneId: string;
  readonly missing: readonly ("sprites" | "background" | "cg" | "artBrief")[];
};

export type ChapterEvaluation = {
  readonly chapterId: string;
  readonly sceneIds: readonly string[];
  readonly reviewId: string | null;
  readonly coverageComplete: boolean;
  readonly missingEvidence: boolean;
  readonly disposition: ReviewDisposition;
  readonly approved: boolean;
};

export type GateBlocker =
  | { readonly kind: "unresolved-asset"; readonly hash: string }
  | { readonly kind: "broken-link"; readonly sceneId: string; readonly target: string }
  | { readonly kind: "duplicate-ending"; readonly titles: readonly string[] }
  | { readonly kind: "absent-content-evidence"; readonly chapterId: string }
  | { readonly kind: "path-bound-exceeded"; readonly unverifiedPaths: readonly string[] }
  | { readonly kind: "unwritten-planned"; readonly sceneIds: readonly string[] }
  | { readonly kind: "chapter-unapproved"; readonly chapterId: string }
  | { readonly kind: "changes-required"; readonly issueIds: readonly string[] }
  | { readonly kind: "technical"; readonly check: "schema" | "graph" | "condition" | "assets" | "runtime" };

export type CompletionGate = {
  readonly technicalGreen: boolean;
  readonly contentPending: boolean;
  readonly previewEligible: boolean;
  readonly proposalReady: boolean;
  readonly blockers: readonly GateBlocker[];
};

export type WorkspaceValidationReport = {
  readonly technical: {
    readonly schema: CheckStatus;
    readonly graph: CheckStatus;
    readonly condition: CheckStatus;
    readonly assets: CheckStatus;
    readonly runtime: CheckStatus;
  };
  readonly requiredAssetsMissing: readonly string[];
  readonly routes: RouteCoverage;
  readonly repetition: readonly RepeatedBody[];
  readonly missingStaging: readonly MissingStaging[];
  readonly content: {
    readonly status: "pending" | "evaluated";
    readonly chapters: readonly ChapterEvaluation[];
  };
  readonly reviews: readonly ReviewRecord[];
  readonly issues: readonly Issue[];
  readonly gate: CompletionGate;
  readonly quota: QuotaRecord | null;
  readonly compact: ValidationReport;
  readonly writtenSceneCount: number;
  readonly plannedSceneCount: number;
};
