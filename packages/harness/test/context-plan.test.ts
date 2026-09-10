import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { validateOutlineDag } from "../src/context.js";
import type { OutlineDagFailure } from "../src/context.js";
import {
  productionDocumentSchema,
  productionOutlineSchema,
} from "../src/production-contracts.js";
import { productionDocument } from "./fixtures.js";

type OutlineInput = z.input<typeof productionOutlineSchema>;
type GraphScene = Readonly<Pick<
  OutlineInput["scenes"][number], "id" | "next" | "choices" | "ending"
>>;

function planInput(
  scenes: readonly GraphScene[],
  start = "s0",
): OutlineInput {
  return {
    title: "Plan", subtitle: "Outline", bible: "Synthetic canon.", start,
    scenes: scenes.map(scene => ({
      chapter: "Chapter", title: scene.id,
      summary: "Scene event.", artDirection: "Scene direction.",
      targetMinutes: 3, background: "title", ...scene,
    })),
  };
}

test("accepts an 80-scene DAG without a legacy 60-scene ceiling", () => {
  // Given a complete 240-minute DAG declared in reverse array order.
  const scenes: GraphScene[] = Array.from({ length: 80 }, (_, index) =>
    index === 79
      ? { id: `s${index}`, ending: "End" }
      : { id: `s${index}`, next: `s${index + 1}` });
  const outline = productionOutlineSchema.parse(planInput(scenes.reverse()));
  // When its structural graph is validated.
  const result = validateOutlineDag(outline);
  // Then all original plan data is retained without applying legacy limits.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.outline, outline);
  assert.equal(result.outline.scenes.length, 80);
});

test("does not impose medium-profile minimums on a structurally valid graph", () => {
  // Given a complete one-scene graph.
  const outline = productionOutlineSchema.parse(planInput([
    { id: "s0", ending: "End" },
  ]));
  // When only structural validity is requested.
  const result = validateOutlineDag(outline);
  // Then profile counts and durations remain the caller's separate responsibility.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.outline, outline);
});

test("accepts reconverging branches with optional unassigned choice IDs", () => {
  // Given a diamond whose two paths share a descendant.
  const outline = productionOutlineSchema.parse(planInput([
    { id: "s0", choices: [
      { text: "Left", next: "s1" },
      { text: "Right", next: "s2" },
    ] },
    { id: "s1", next: "s3" },
    { id: "s2", next: "s3" },
    { id: "s3", ending: "End" },
  ]));
  // When the graph is checked.
  const result = validateOutlineDag(outline);
  // Then reconvergence is not confused with a cycle or missing choice identities.
  assert.equal(result.kind, "ready");
});

test("accepts distinct choices sharing the same destination", () => {
  // Given parallel edges representing distinct authored choices.
  const outline = productionOutlineSchema.parse(planInput([
    { id: "s0", choices: [
      { id: "a", text: "First", next: "s1" },
      { id: "b", text: "Second", next: "s1" },
    ] },
    { id: "s1", ending: "End" },
  ]));
  // When the graph is checked.
  const result = validateOutlineDag(outline);
  // Then parallel edges do not create a false cycle.
  assert.equal(result.kind, "ready");
});

test("allows the same choice ID in different scene scopes", () => {
  // Given scene-scoped choice identities.
  const outline = productionOutlineSchema.parse(planInput([
    { id: "s0", choices: [{ id: "shared", text: "Go", next: "s1" }] },
    { id: "s1", choices: [{ id: "shared", text: "Go", next: "s2" }] },
    { id: "s2", ending: "End" },
  ]));
  // When identities and topology are checked.
  const result = validateOutlineDag(outline);
  // Then a valid scoped identity is not treated as a global collision.
  assert.equal(result.kind, "ready");
});

type FailureFixture = {
  readonly name: string;
  readonly scenes: readonly GraphScene[];
  readonly start?: string;
  readonly reason: Exclude<OutlineDagFailure, "UNIMPLEMENTED">;
};

const failures: readonly FailureFixture[] = [
  {
    name: "empty outline has no entry scene",
    scenes: [], reason: "START_NOT_FOUND",
  },
  {
    name: "declared start does not exist",
    scenes: [{ id: "s0", ending: "End" }], start: "missing",
    reason: "START_NOT_FOUND",
  },
  {
    name: "duplicate scene identities",
    scenes: [{ id: "s0", ending: "First" }, { id: "s0", ending: "Second" }],
    reason: "DUPLICATE_SCENE_ID",
  },
  {
    name: "duplicate defined choice identities within one scene",
    scenes: [
      { id: "s0", choices: [
        { id: "same", text: "Left", next: "s1" },
        { id: "same", text: "Right", next: "s2" },
      ] },
      { id: "s1", ending: "Left end" },
      { id: "s2", ending: "Right end" },
    ], reason: "DUPLICATE_CHOICE_ID",
  },
  {
    name: "next destination does not exist",
    scenes: [{ id: "s0", next: "missing" }],
    reason: "TARGET_NOT_FOUND",
  },
  {
    name: "choice destination does not exist",
    scenes: [{ id: "s0", choices: [{ text: "Go", next: "missing" }] }],
    reason: "TARGET_NOT_FOUND",
  },
  {
    name: "scene has no exit",
    scenes: [{ id: "s0" }], reason: "INVALID_SCENE_EXIT",
  },
  {
    name: "empty choices do not provide an exit",
    scenes: [{ id: "s0", choices: [] }], reason: "INVALID_SCENE_EXIT",
  },
  {
    name: "empty ending marker does not provide an exit",
    scenes: [{ id: "s0", ending: "" }], reason: "INVALID_SCENE_EXIT",
  },
  {
    name: "next and ending conflict",
    scenes: [{ id: "s0", next: "s1", ending: "End" }, { id: "s1", ending: "End" }],
    reason: "INVALID_SCENE_EXIT",
  },
  {
    name: "next and choices conflict",
    scenes: [
      { id: "s0", next: "s1", choices: [{ text: "Go", next: "s1" }] },
      { id: "s1", ending: "End" },
    ], reason: "INVALID_SCENE_EXIT",
  },
  {
    name: "choices and ending conflict",
    scenes: [
      { id: "s0", ending: "End", choices: [{ text: "Go", next: "s1" }] },
      { id: "s1", ending: "End" },
    ], reason: "INVALID_SCENE_EXIT",
  },
  {
    name: "self cycle",
    scenes: [{ id: "s0", next: "s0" }], reason: "OUTLINE_CYCLE",
  },
  {
    name: "multi-node cycle",
    scenes: [
      { id: "s0", next: "s1" },
      { id: "s1", next: "s2" },
      { id: "s2", next: "s0" },
    ], reason: "OUTLINE_CYCLE",
  },
  {
    name: "cycle remains invalid despite an available ending",
    scenes: [
      { id: "s0", choices: [
        { text: "Loop", next: "s1" },
        { text: "Leave", next: "s2" },
      ] },
      { id: "s1", next: "s0" },
      { id: "s2", ending: "End" },
    ], reason: "OUTLINE_CYCLE",
  },
  {
    name: "disconnected cycle",
    scenes: [
      { id: "s0", ending: "End" },
      { id: "s1", next: "s2" },
      { id: "s2", next: "s1" },
    ], reason: "OUTLINE_CYCLE",
  },
  {
    name: "disabled conditional edge cannot hide a structural cycle",
    scenes: [
      { id: "s0", choices: [
        { text: "Loop", next: "s0", disable: true, when: { all: ["closed"] } },
        { text: "Leave", next: "s1" },
      ] },
      { id: "s1", ending: "End" },
    ], reason: "OUTLINE_CYCLE",
  },
  {
    name: "unreachable acyclic component",
    scenes: [{ id: "s0", ending: "End" }, { id: "s1", ending: "Other end" }],
    reason: "UNREACHABLE_SCENE",
  },
];

for (const fixture of failures) {
  test(`blocks ${fixture.name}`, () => {
    // Given shape-valid data with the named structural defect.
    const outline = productionOutlineSchema.parse(
      planInput(fixture.scenes, fixture.start),
    );
    // When the explicit approval prerequisite is evaluated.
    const result = validateOutlineDag(outline);
    // Then the defect is reported without repairing or mutating the outline.
    assert.deepEqual(result, { kind: "blocked", reason: fixture.reason });
  });
}

const permissiveDocuments: readonly {
  readonly name: string;
  readonly scenes: readonly GraphScene[];
}[] = [
  { name: "empty draft", scenes: [] },
  { name: "partial outline", scenes: [{ id: "s0", next: "planned-tail" }] },
  { name: "existing cyclic outline", scenes: [{ id: "s0", next: "s0" }] },
];

for (const fixture of permissiveDocuments) {
  test(`keeps ${fixture.name} parseable by the generic document schema`, () => {
    // Given existing document data outside the new-plan approval boundary.
    const input = { ...productionDocument, outline: planInput(fixture.scenes) };
    // When the generic persistence/import schema parses it.
    const result = productionDocumentSchema.safeParse(input);
    // Then opt-in DAG policy has not become a global parsing restriction.
    assert.equal(result.success, true);
  });
}
