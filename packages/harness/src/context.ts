import { admitBudget } from "./budget.js";
import type { BudgetAdmission, BudgetRequest } from "./budget-contracts.js";
import type { ContextManifest, ReadSet, Target } from "./context-contracts.js";
import type { Line, Scene } from "@vnmaker/content";
import type { z } from "zod";
import { canonicalHash } from "./canonical.js";
import type {
  CandidateRef, LineId, ProjectHead, SceneId, Sha256,
} from "./primitives.js";
import type {
  ApprovedArtBinding, CanonEntry, ProductionDocument,
} from "./production-contracts.js";
import type { scriptSchema } from "./script-contracts.js";

export type BranchContextRequest = {
  readonly script: z.infer<typeof scriptSchema>;
  readonly facts: readonly CanonEntry[];
  readonly sceneId: SceneId;
  readonly maxVisitedStates: number;
};
export type BranchContextResult =
  | { readonly kind: "ready"; readonly common: readonly CanonEntry[];
      readonly conditional: readonly CanonEntry[] }
  | { readonly kind: "blocked"; readonly reason: string };

export type ContextManifestInput = Omit<ContextManifest, "inputContentHash">;
export type ContextManifestResult =
  | {
      readonly kind: "ready";
      readonly manifest: ContextManifest;
      readonly admission?: BudgetAdmission;
    }
  | {
      readonly kind: "blocked";
      readonly reason: "STALE_REQUIRED_CONTEXT";
    }
  | {
      readonly kind: "budget-blocked";
      readonly manifest: ContextManifest;
      readonly admission: BudgetAdmission;
    };

export async function buildContextManifest(
  input: ContextManifestInput,
  required?: ContextManifest,
  budget?: BudgetRequest,
): Promise<ContextManifestResult> {
  const { sourceHead, facts, ...content } = input;
  const inputContentHash = await canonicalHash({
    ...content,
    facts: facts.map(({ sourceHead: _origin, ...fact }) => fact),
  });
  if (required && (
    required.sourceHead.projectId !== sourceHead.projectId ||
    required.sourceHead.lineageId !== sourceHead.lineageId ||
    required.inputContentHash !== inputContentHash
  )) {
    return { kind: "blocked", reason: "STALE_REQUIRED_CONTEXT" };
  }
  const manifest: ContextManifest = { ...input, inputContentHash };
  if (!budget) return { kind: "ready", manifest };
  // The adapter supplies measurements/counter evidence for its complete request.
  const admission = admitBudget(budget);
  return admission.allowed
    ? { kind: "ready", manifest, admission }
    : { kind: "budget-blocked", manifest, admission };
}

export type ContextSource = {
  readonly sourceHead: ProjectHead;
  readonly candidateRef: CandidateRef;
  readonly script: z.infer<typeof scriptSchema>;
  readonly productionDocument: ProductionDocument;
};

export type SceneContextResult =
  | {
      readonly kind: "ready";
      readonly metadata: Omit<Scene, "lines">;
      readonly lines: readonly Line[];
      readonly window: ContextManifest["windows"][number];
      readonly sceneHash: Sha256;
      readonly referenceBindings: readonly ApprovedArtBinding[];
      readonly referenceBindingHashes: ContextManifest["referenceBindingHashes"];
      readonly beforeLineId: LineId | null;
      readonly afterLineId: LineId | null;
      readonly readSet: ReadSet;
      readonly excluded: ContextManifest["excluded"];
    }
  | { readonly kind: "blocked"; readonly reason: string };

export type ContextSearchHit =
  | (Extract<Target, { kind: "line" | "choice" }> & {
      readonly text: string;
      readonly hash: Sha256;
    })
  | (Extract<Target, { kind: "canon" }> & {
      readonly entry: CanonEntry;
      readonly hash: Sha256;
    });

export type SearchContextResult =
  | {
      readonly kind: "ready";
      readonly hits: readonly ContextSearchHit[];
      readonly readSet: ReadSet;
      readonly nextCursor: string | null;
    }
  | { readonly kind: "blocked"; readonly reason: string };

export { buildBranchContext, readBranchContext } from "./context-branch.js";
export { readReferenceContext } from "./context-reference.js";
export { readSceneContext } from "./context-read.js";
export { searchContext } from "./context-search.js";

export type ReferenceContextResult =
  | {
      readonly kind: "ready";
      readonly referenceBindings: readonly ApprovedArtBinding[];
      readonly referenceBindingHashes: ContextManifest["referenceBindingHashes"];
      readonly readSet: ReadSet;
    }
  | { readonly kind: "blocked"; readonly reason: string };

export type BranchReadResult =
  | (Extract<BranchContextResult, { kind: "ready" }> & {
      readonly readSet: ReadSet;
      readonly facts: ContextManifest["facts"];
    })
  | Extract<BranchContextResult, { kind: "blocked" }>;

export { validateOutlineDag } from "./context-plan.js";
export type { OutlineDagFailure, OutlineDagResult } from "./context-plan.js";

export { replayContextDependencies } from "./context-replay.js";
export type { ContextDependencyReplay } from "./context-replay.js";
