import assert from "node:assert/strict";
import test from "node:test";
import { buildBranchContext } from "../src/context.js";
import { scriptSchema } from "../src/script-contracts.js";
import { canonEntrySchema } from "../src/production-contracts.js";
import { sceneIdSchema } from "../src/primitives.js";

function cycleScript(limit?: number) {
  return scriptSchema.parse({
    title: "Cycle", subtitle: "", start: "loop", characters: [],
    flags: { score: 0 },
    scenes: [
      {
        id: "loop", background: "title",
        lines: [{ id: "l1", speaker: null, text: "Again." }],
        choices: [
          {
            id: "again", text: "Again", next: "loop",
            add: { score: 1 },
            when: limit === undefined ? undefined : {
              compare: [{ flag: "score", op: "lt", value: limit }],
            },
          },
          { id: "leave", text: "Leave", next: "end" },
        ],
      },
      {
        id: "end", background: "title",
        lines: [{ id: "l1", speaker: null, text: "Done." }],
        ending: "End",
      },
    ],
  });
}

for (const target of ["loop", "end"]) {
  test(`required-context-does-not-fit blocks exhausted traversal to ${target}`, () => {
    // Given an unbounded changing-state loop with an available exit.
    const request = {
      script: cycleScript(), facts: [],
      sceneId: sceneIdSchema.parse(target), maxVisitedStates: 3,
    };
    // When arrival context is requested within a finite bound.
    const result = buildBranchContext(request);
    // Then partial traversal cannot be presented as complete context.
    assert.deepEqual(result, {
      kind: "blocked", reason: "STATE_BOUND_EXCEEDED",
    });
  });
}

test("includes conditional facts from later target arrivals", () => {
  // Given a finite loop with a fact applicable on its third arrival.
  const later = canonEntrySchema.parse({
    id: "later", category: "branch-fact",
    text: "The mechanism has turned twice.",
    characterIds: [], sceneIds: ["loop"], relatedEntryIds: [],
    truth: { kind: "world" },
    applicability: {
      anyOf: [{ compare: [{ flag: "score", op: "eq", value: 2 }] }],
    },
  });
  const request = {
    script: cycleScript(2), facts: [later],
    sceneId: sceneIdSchema.parse("loop"), maxVisitedStates: 10,
  };
  // When context includes all reachable target arrivals.
  const result = buildBranchContext(request);
  // Then the later fact retains its conditional attribution.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.conditional, [later]);
});

test("does not charge nonreturning descendants against the arrival bound", () => {
  // Given a target whose only available exit never returns.
  const request = {
    script: cycleScript(0), facts: [],
    sceneId: sceneIdSchema.parse("loop"), maxVisitedStates: 1,
  };
  // When its single arrival is analyzed.
  const result = buildBranchContext(request);
  // Then downstream work does not exhaust the arrival bound.
  assert.equal(result.kind, "ready");
});
