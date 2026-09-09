import { chapterOrder } from "./production-dag.js";
import type { ProductionSession, ProposalGate } from "./production-types.js";

function writtenBeatIds(session: ProductionSession): ReadonlySet<string> {
  const beatIds = new Set(session.beats.map(beat => beat.id));
  const written = new Set<string>();
  for (const scene of session.scenes) {
    if (beatIds.has(scene.id) && scene.lines.length > 0) written.add(scene.id);
  }
  return written;
}

export function previewEligibleSceneIds(session: ProductionSession): readonly string[] {
  return [...writtenBeatIds(session)];
}

export function proposalGate(session: ProductionSession): ProposalGate {
  if (session.initialScope === "imported-draft") return { kind: "blocked", reason: "imported-review" };
  if (!session.planApproved) return { kind: "blocked", reason: "plan-unapproved" };
  const written = writtenBeatIds(session);
  if (session.beats.some(beat => !written.has(beat.id))) return { kind: "blocked", reason: "unwritten-planned-target" };
  const order = chapterOrder(session.beats);
  const approved = new Set(session.chapterApprovals.map(row => row.chapterId));
  if (order.some(id => !approved.has(id))) return { kind: "blocked", reason: "partial-chapters" };
  return { kind: "ready", digest: session.hasher.hash(`proposal:${order.join(",")}`) };
}

export function publicApplyDecision(session: ProductionSession): { readonly ok: true; readonly digest: string } | { readonly ok: false; readonly code: "REVIEW_REQUIRED" | "PREVIEW_NOT_RELEASE" } {
  const gate = proposalGate(session);
  switch (gate.kind) {
    case "ready": return { ok: true, digest: gate.digest };
    case "blocked":
      return { ok: false, code: gate.reason === "unwritten-planned-target" || gate.reason === "partial-chapters" ? "PREVIEW_NOT_RELEASE" : "REVIEW_REQUIRED" };
  }
}

export function publicExportDecision(session: ProductionSession): { readonly ok: true } | { readonly ok: false; readonly code: "PREVIEW_NOT_RELEASE" } {
  const apply = publicApplyDecision(session);
  return apply.ok ? { ok: true } : { ok: false, code: "PREVIEW_NOT_RELEASE" };
}
