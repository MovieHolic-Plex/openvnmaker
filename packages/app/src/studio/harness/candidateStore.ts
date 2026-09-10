import { parseScript, type VnScript } from "@vnmaker/content";

declare global {
  interface Window { __harnessCandidateHooks?: boolean }
}
import {
  candidateRefSchema, parseProductionDocument, parseProjectHead, revisionSchema,
  type CandidateRef, type ProductionDocument, type ProjectHead,
} from "@vnmaker/harness";
import { candidateStorageKey, emitHarnessUi } from "./harnessEvents.js";
import { firstChapterDraft, unwrittenNextDraft } from "./firstChapterDraft.js";

export type CandidateWorkspace = {
  readonly runId: string;
  readonly sourceHead: ProjectHead;
  readonly candidateRef: CandidateRef;
  readonly script: VnScript;
  readonly productionDocument: ProductionDocument;
  readonly brief: string;
  readonly planApproved: boolean;
  readonly openPreviewHash: string | null;
};

export type BudgetMeter = {
  readonly textContextBytes: number;
  readonly countedInputTokens: number | null;
  readonly tokenCheck: "pass" | "fail" | "unknown";
  readonly tokenWindowMode: "input-only" | "combined" | "unknown";
  readonly knownInputUsage: number | null;
  readonly knownOutputUsage: number | null;
  readonly policy: "exact-only" | "bounded-payload";
  readonly allowed: boolean;
  readonly reason: string | null;
};

let workspace: CandidateWorkspace | null = null;
let meter: BudgetMeter | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(next: CandidateWorkspace): void {
  workspace = next;
  try {
    sessionStorage.setItem(candidateStorageKey(next.runId), JSON.stringify({
      runId: next.runId, sourceHead: next.sourceHead, candidateRef: next.candidateRef,
      script: next.script, productionDocument: next.productionDocument, brief: next.brief,
      planApproved: next.planApproved, openPreviewHash: next.openPreviewHash,
    }));
  } catch { /* studio save already reports storage */ }
  emit();
  emitHarnessUi("candidate", { runId: next.runId, revision: next.candidateRef.revision, title: next.script.title });
}

export function subscribeCandidateWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCandidateWorkspace(): CandidateWorkspace | null { return workspace; }
export function getBudgetMeter(): BudgetMeter | null { return meter; }

export function publishBudgetMeter(next: BudgetMeter): void {
  meter = next;
  emit();
  emitHarnessUi("admission", next);
}

export function openCandidateWorkspace(next: CandidateWorkspace): void {
  persist(next);
}

export function restoreCandidateWorkspace(runId: string): CandidateWorkspace | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(candidateStorageKey(runId)) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const row = raw as Record<string, unknown>;
    const restored = {
      runId: String(row["runId"]), sourceHead: parseProjectHead(row["sourceHead"]), candidateRef: candidateRefSchema.parse(row["candidateRef"]),
      script: parseScript(row["script"]), productionDocument: parseProductionDocument(row["productionDocument"]),
      brief: String(row["brief"] ?? ""), planApproved: row["planApproved"] === true,
      openPreviewHash: typeof row["openPreviewHash"] === "string" ? row["openPreviewHash"] : null,
    };
    workspace = restored;
    emit();
    return restored;
  } catch { return null; }
}

export function approveCandidatePlan(brief: string): void {
  if (workspace === null) return;
  persist({
    ...workspace, brief, planApproved: true,
    productionDocument: parseProductionDocument({ ...workspace.productionDocument, brief }),
  });
  emitHarnessUi("plan", { brief, sourceRevision: workspace.sourceHead.revision });
}

export function patchCandidateScript(script: VnScript): void {
  if (workspace === null) return;
  persist({
    ...workspace, script: parseScript(script),
    candidateRef: { ...workspace.candidateRef, revision: revisionSchema.parse(workspace.candidateRef.revision + 1) },
  });
}

export function patchCandidateDocument(productionDocument: ProductionDocument): void {
  if (workspace === null) return;
  persist({
    ...workspace, productionDocument: parseProductionDocument(productionDocument),
    candidateRef: { ...workspace.candidateRef, revision: revisionSchema.parse(workspace.candidateRef.revision + 1) },
  });
}

function installDraft(build: (title: string) => { readonly script: VnScript; readonly productionDocument: ProductionDocument }): void {
  if (workspace === null) return;
  const draft = build(workspace.script.title);
  persist({
    ...workspace, script: draft.script, productionDocument: draft.productionDocument,
    candidateRef: { ...workspace.candidateRef, revision: revisionSchema.parse(workspace.candidateRef.revision + 1) },
  });
}

export function installFirstChapterCandidate(): void { installDraft(firstChapterDraft); }
export function installUnwrittenNextCandidate(): void { installDraft(unwrittenNextDraft); }

export function rememberOpenPreview(snapshotHash: string): void {
  if (workspace === null) return;
  persist({ ...workspace, openPreviewHash: snapshotHash });
}

function readMeter(detail: unknown): BudgetMeter | null {
  if (typeof detail !== "object" || detail === null) return null;
  const row = detail as Record<string, unknown>;
  const tokenCheck = row["tokenCheck"];
  const tokenWindowMode = row["tokenWindowMode"];
  const policy = row["policy"];
  if (tokenCheck !== "pass" && tokenCheck !== "fail" && tokenCheck !== "unknown") return null;
  if (tokenWindowMode !== "input-only" && tokenWindowMode !== "combined" && tokenWindowMode !== "unknown") return null;
  if (policy !== "exact-only" && policy !== "bounded-payload") return null;
  if (typeof row["textContextBytes"] !== "number") return null;
  return {
    textContextBytes: row["textContextBytes"],
    countedInputTokens: typeof row["countedInputTokens"] === "number" ? row["countedInputTokens"] : null,
    tokenCheck, tokenWindowMode, policy,
    knownInputUsage: typeof row["knownInputUsage"] === "number" ? row["knownInputUsage"] : null,
    knownOutputUsage: typeof row["knownOutputUsage"] === "number" ? row["knownOutputUsage"] : null,
    allowed: row["allowed"] === true, reason: typeof row["reason"] === "string" ? row["reason"] : null,
  };
}

export function bindCandidateWorkspaceHooks(): void {
  if (typeof window === "undefined" || window.__harnessCandidateHooks) return;
  window.__harnessCandidateHooks = true;
  window.addEventListener("vnmaker:harness-publish-admission", event => {
    if (!(event instanceof CustomEvent)) return;
    const meter = readMeter(event.detail);
    if (meter !== null) publishBudgetMeter(meter);
  });
  window.addEventListener("vnmaker:harness-patch-candidate-title", event => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string" || workspace === null) return;
    patchCandidateScript({ ...workspace.script, title: event.detail });
  });
}

