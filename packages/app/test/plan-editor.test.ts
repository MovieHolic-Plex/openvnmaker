import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseProductionDocument, type CanonEntry, type ProductionDocument, type ProductionOutline,
} from "@vnmaker/harness";
import {
  candidateApprovalGate, canonChangeImpact, createPlanProjects, createPlanSession, openCandidateSession,
  pathDurationView, planContextView, proposalConflicts, reducePlanSession, validateAuthoredPlan,
  type PlanDraftUnit,
} from "../src/studio/harness/planEditorModel.js";

function scene(id: string, extra: Record<string, unknown>, minutes = 3) {
  return {
    id, chapter: "1", title: id, summary: "Beat summary.", artDirection: "Direction.",
    targetMinutes: minutes, background: "title", ...extra,
  };
}

function outlineOf(scenes: ProductionOutline["scenes"], start = "s0"): ProductionOutline {
  return { title: "Plan", subtitle: "sub", bible: "bible text", start, scenes };
}

function documentOf(outline: ProductionOutline, extra: Partial<ProductionDocument> = {}): ProductionDocument {
  return parseProductionDocument({
    version: 1, brief: extra.brief ?? "brief",
    castCanon: extra.castCanon ?? [], worldTimeline: extra.worldTimeline ?? [],
    branchFacts: extra.branchFacts ?? [], outline, artDirection: extra.artDirection ?? [],
    referenceBindings: extra.referenceBindings ?? [],
  });
}

function linear(count: number): ProductionOutline {
  return outlineOf(Array.from({ length: count }, (_, index) => (
    index === count - 1 ? scene(`s${index}`, { ending: "End" }) : scene(`s${index}`, { next: `s${index + 1}` })
  )));
}

const valid = documentOf(outlineOf([
  scene("s0", { choices: [{ text: "Left", next: "s1" }, { text: "Right", next: "s2" }] }, 10),
  scene("s1", { ending: "Left end" }, 5),
  scene("s2", { ending: "Right end" }, 20),
]));

const fact = (id: string, sceneIds: readonly string[] = ["s1"], rest: Partial<CanonEntry> = {}): CanonEntry => ({
  id, category: "world-fact", text: `${id} text`, characterIds: [], sceneIds, relatedEntryIds: [], ...rest,
});

test("source-vs-candidate-edit-effects-on-head-revision", () => {
  const opened = openCandidateSession(createPlanSession("project-a", valid));
  const sourceEdit = reducePlanSession(opened, {
    kind: "edit", scope: "source", document: parseProductionDocument({ ...valid, brief: "source-brief" }),
  });
  assert.equal(sourceEdit.ok, true);
  if (!sourceEdit.ok) return;
  assert.equal(sourceEdit.session.sourceRevision, 1);
  assert.equal(sourceEdit.session.candidateRevision, 0);
  assert.equal(proposalConflicts(sourceEdit.session), true);
  const candidateEdit = reducePlanSession(opened, {
    kind: "edit", scope: "candidate", document: parseProductionDocument({ ...valid, brief: "candidate-brief" }),
  });
  assert.equal(candidateEdit.ok, true);
  if (!candidateEdit.ok) return;
  assert.equal(candidateEdit.session.sourceRevision, 0);
  assert.equal(candidateEdit.session.candidateRevision, 1);
  assert.equal(candidateEdit.session.sourceDocument.brief, "brief");
  assert.equal(proposalConflicts(candidateEdit.session), false);
});

test("per-path-duration", () => {
  const view = pathDurationView(valid.outline);
  assert.equal(view.minMinutes, 15);
  assert.equal(view.maxMinutes, 30);
  assert.equal(view.summedMinutes, 35);
  assert.equal(view.label.includes("15"), true);
  assert.equal(view.label.includes("30"), true);
  assert.equal(view.label.includes("35"), false);
});

test("canon-change-unit-invalidation", () => {
  const units: readonly PlanDraftUnit[] = [
    { unitId: "unit-s1", kind: "scene-draft", sceneIds: ["s1"], factIds: ["world-1"], status: "ready" },
    { unitId: "unit-s2", kind: "scene-draft", sceneIds: ["s2"], factIds: ["other"], status: "ready" },
  ];
  const previous = documentOf(valid.outline, { worldTimeline: [fact("world-1"), fact("other", ["s2"])] });
  const next = documentOf(valid.outline, {
    worldTimeline: [fact("world-1", ["s1"], { text: "changed world" }), fact("other", ["s2"])],
  });
  const impact = canonChangeImpact(previous, next, units);
  assert.deepEqual(impact.changedEntryIds, ["world-1"]);
  assert.deepEqual(impact.affectedSceneIds, ["s1"]);
  assert.deepEqual(impact.staleUnitIds, ["unit-s1"]);
  const session = openCandidateSession(createPlanSession("project-a", previous, units));
  const edited = reducePlanSession(session, { kind: "edit", scope: "candidate", document: next });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.session.units.find(unit => unit.unitId === "unit-s1")?.status, "stale");
  assert.equal(edited.session.units.find(unit => unit.unitId === "unit-s2")?.status, "ready");
});

test("stale-candidate-approval-refusal", () => {
  const opened = openCandidateSession(createPlanSession("project-a", valid));
  const afterSource = reducePlanSession(opened, {
    kind: "edit", scope: "source", document: parseProductionDocument({ ...valid, brief: "moved-head" }),
  });
  assert.equal(afterSource.ok, true);
  if (!afterSource.ok) return;
  const gate = candidateApprovalGate(afterSource.session);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.reason, "stale-candidate");
  const refused = reducePlanSession(afterSource.session, { kind: "approve-candidate" });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.reason, "stale-candidate");
  assert.equal(refused.session.planApproved, false);
  assert.equal(refused.session.sourceRevision, 1);
});

test("80-scene-acceptance-and-81-rejection", () => {
  const eighty = documentOf(linear(80));
  const eightyOne = documentOf(linear(81));
  assert.deepEqual(validateAuthoredPlan(eighty, "manual"), { ok: true });
  assert.deepEqual(validateAuthoredPlan(eighty, "generated"), { ok: true });
  assert.deepEqual(validateAuthoredPlan(eightyOne, "manual"), { ok: false, reason: "SCENE_LIMIT" });
  assert.deepEqual(validateAuthoredPlan(eightyOne, "generated"), { ok: false, reason: "SCENE_LIMIT" });
  const session = openCandidateSession(createPlanSession("project-a", valid));
  assert.equal(reducePlanSession(session, { kind: "apply-generated", scope: "candidate", document: eighty }).ok, true);
  const rejected = reducePlanSession(session, { kind: "edit", scope: "candidate", document: eightyOne });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.reason, "SCENE_LIMIT");
});

test("project-a-b-isolation", () => {
  const projects = createPlanProjects();
  const docA = parseProductionDocument({ ...valid, brief: "alpha" });
  const docB = parseProductionDocument({ ...valid, brief: "beta" });
  projects.set(createPlanSession("project-a", docA));
  projects.set(createPlanSession("project-b", docB));
  const editedA = reducePlanSession(projects.get("project-a") ?? createPlanSession("missing", valid), {
    kind: "edit", scope: "source", document: parseProductionDocument({ ...valid, brief: "alpha-edited" }),
  });
  assert.equal(editedA.ok, true);
  if (!editedA.ok) return;
  projects.set(editedA.session);
  assert.equal(projects.get("project-a")?.sourceDocument.brief, "alpha-edited");
  assert.equal(projects.get("project-b")?.sourceDocument.brief, "beta");
  assert.equal(projects.get("project-b")?.sourceRevision, 0);
  const sources = planContextView(editedA.session.sourceDocument).sourceIds;
  assert.equal(planContextView(editedA.session.sourceDocument).sourceIds.join(), sources.join());
  assert.notEqual(projects.get("project-a")?.sourceDocument.brief, projects.get("project-b")?.sourceDocument.brief);
});

test("invalid-branch-and-unreachable-ending-refusal", () => {
  const invalidBranch = documentOf(outlineOf([scene("s0", { next: "missing" })]));
  const unreachable = documentOf(outlineOf([
    scene("s0", { ending: "Reachable" }),
    scene("s1", { ending: "Unreachable" }),
  ]));
  assert.deepEqual(validateAuthoredPlan(invalidBranch, "manual"), { ok: false, reason: "TARGET_NOT_FOUND" });
  assert.deepEqual(validateAuthoredPlan(invalidBranch, "generated"), { ok: false, reason: "TARGET_NOT_FOUND" });
  assert.deepEqual(validateAuthoredPlan(unreachable, "manual"), { ok: false, reason: "UNREACHABLE_SCENE" });
  const session = openCandidateSession(createPlanSession("project-a", valid));
  const branch = reducePlanSession(session, { kind: "edit", scope: "candidate", document: invalidBranch });
  const ending = reducePlanSession(session, { kind: "apply-generated", scope: "source", document: unreachable });
  assert.equal(branch.ok, false);
  assert.equal(ending.ok, false);
  if (branch.ok || ending.ok) return;
  assert.equal(branch.reason, "TARGET_NOT_FOUND");
  assert.equal(ending.reason, "UNREACHABLE_SCENE");
  assert.equal(session.planApproved, false);
});

test("candidate-plan-approval-keeps-source-head", () => {
  const opened = openCandidateSession(createPlanSession("project-a", valid));
  const approved = reducePlanSession(opened, { kind: "approve-candidate" });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.session.sourceRevision, 0);
  assert.equal(approved.session.candidateRevision, 0);
  assert.equal(approved.session.planApproved, true);
  assert.equal(proposalConflicts(approved.session), false);
  const omitted = planContextView(valid, ["hidden"]);
  assert.deepEqual(omitted.omitted, [{ id: "hidden", reason: "omitted" }]);
});
