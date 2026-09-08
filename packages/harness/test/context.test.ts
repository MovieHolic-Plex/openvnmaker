import assert from "node:assert/strict";
import test from "node:test";
import { buildBranchContext } from "../src/context.js";
import { scriptSchema } from "../src/script-contracts.js";
import { canonEntrySchema } from "../src/production-contracts.js";
import { sceneIdSchema } from "../src/primitives.js";

const script = scriptSchema.parse({
  title: "Branch attribution", subtitle: "", start: "start",
  characters: [
    { id: "witness", name: "Witness", bio: "", color: "#112233" },
  ],
  flags: { route: "", score: 0 },
  scenes: [
    {
      id: "start", background: "title",
      lines: [{ id: "l1", speaker: null, text: "Choose." }],
      choices: [
        { id: "a", text: "A", next: "a",
          set: { route: "a" }, add: { score: 1 } },
        { id: "b", text: "B", next: "b",
          set: { route: "b" }, add: { score: 2 } },
      ],
    },
    {
      id: "a", background: "title",
      lines: [{ id: "l1", speaker: null, text: "A." }], next: "join",
    },
    {
      id: "b", background: "title",
      lines: [{ id: "l1", speaker: null, text: "B." }], next: "join",
    },
    {
      id: "join", background: "title",
      lines: [{ id: "l1", speaker: null, text: "Join." }], ending: "End",
    },
  ],
});

const common = canonEntrySchema.parse({
  id: "common", category: "world-fact", text: "The tower exists.",
  characterIds: [], sceneIds: [], relatedEntryIds: [],
  truth: { kind: "world" },
});
const aOnly = canonEntrySchema.parse({
  id: "a-only", category: "branch-fact", text: "The key was destroyed.",
  characterIds: [], sceneIds: ["a"], relatedEntryIds: [],
  truth: { kind: "world" },
  applicability: { anyOf: [{ compare: [
    { flag: "route", op: "eq", value: "a" },
    { flag: "score", op: "eq", value: 1 },
  ] }] },
});
const bOnly = canonEntrySchema.parse({
  id: "b-only", category: "branch-fact", text: "The key was preserved.",
  characterIds: [], sceneIds: ["b"], relatedEntryIds: [],
  truth: { kind: "world" },
  applicability: { anyOf: [{ compare: [
    { flag: "route", op: "eq", value: "b" },
    { flag: "score", op: "eq", value: 2 },
  ] }] },
});
const belief = canonEntrySchema.parse({
  ...aOnly, id: "witness-belief", text: "The witness believes it survived.",
  characterIds: ["witness"],
  truth: { kind: "belief", holderCharacterId: "witness" },
});
const facts = [common, aOnly, bOnly, belief];

test("branch-join-attribution", () => {
  // Given two mutually exclusive routes entering the same scene.
  const request = {
    script, facts, sceneId: sceneIdSchema.parse("join"),
    maxVisitedStates: 100,
  };
  // When context is selected for their join.
  const result = buildBranchContext(request);
  // Then only unconditional world facts are common.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.common, [common]);
  assert.deepEqual(result.conditional, [aOnly, bOnly, belief]);
});

test("branch-join-attribution excludes the unvisited sibling", () => {
  // Given a scene reached only through route B.
  const request = {
    script, facts, sceneId: sceneIdSchema.parse("b"),
    maxVisitedStates: 100,
  };
  // When context is selected for that scene.
  const result = buildBranchContext(request);
  // Then route A's facts and belief are absent.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.common, [common]);
  assert.deepEqual(result.conditional, [bOnly]);
});
