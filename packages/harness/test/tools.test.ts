import assert from "node:assert/strict";
import { test } from "node:test";
import { choiceOperationSchema, lineOperationSchema, parseToolEnvelope, sceneExitSchema, toolArgumentsSchemas } from "@vnmaker/harness";
import { hash, insert, uuid } from "./fixtures.js";

const argumentsByTool = {
  project_overview: {}, search_content: { query: "hi", kinds: ["line", "choice", "canon"] },
  read_scene: { sceneId: "start" }, read_canon: { sectionIds: ["cast"] },
  propose_canon: { sectionId: "cast", expectedSectionHash: hash, replacement: { kind: "entries", entries: [] }, reason: "review" },
  patch_project: { expectedMetadataHash: hash, patch: { set: { subtitle: "" }, unset: ["artDirection"] } },
  patch_state: { expectedStateHash: hash, declare: [{ id: "score", value: 1 }], setInitial: [], remove: [] },
  create_scene: { sceneId: "start", planBeatId: "beat", metadata: { background: "title" },
    lines: [{ clientKey: "key", value: { speaker: null, text: "Hello" } }], exit: { kind: "ending", title: "End" } },
  delete_scene: { sceneId: "start", expectedSceneHash: hash }, patch_lines: insert.arguments,
  patch_choices: { sceneId: "start", operations: [{ kind: "delete", choiceId: "c-a", expectedEntityHash: hash }] },
  set_scene: { sceneId: "start", expectedSceneHash: hash, patch: { set: { framing: "wide" }, unset: [] }, exit: { kind: "planned", sceneId: "future" } },
  upsert_character: { characterId: "hero", expectedCharacterHash: null, value: { id: "hero", name: "Hero", color: "#112233", bio: "" } },
  request_art: { assetRequestId: "art", kind: "reference", target: { kind: "character", characterId: "hero" }, referenceBindingIds: [], brief: "Hero" },
  validate_candidate: { mode: "proposal" },
} satisfies Record<keyof typeof toolArgumentsSchemas, unknown>;

for (const [tool, args] of Object.entries(argumentsByTool)) {
  test(`parses ${tool} when its arguments match the contract`, () => {
    // Given
    const input = { callId: uuid, candidateId: uuid, expectedCandidateRevision: 0, tool, arguments: args };
    // When
    const parsed = parseToolEnvelope(input);
    // Then
    assert.deepEqual(parsed, input);
  });
  test(`rejects ${tool} when an argument field is unknown`, () => {
    // Given
    const input = { callId: uuid, candidateId: uuid, expectedCandidateRevision: 0, tool, arguments: { ...args, unknown: true } };
    // When / Then
    assert.throws(() => parseToolEnvelope(input));
  });
}

for (const [schema, idKey, entriesKey, value] of [
  [lineOperationSchema, "lineId", "lines", { speaker: null, text: "Hello" }],
  [choiceOperationSchema, "choiceId", "choices", { text: "Go", next: "next" }],
] as const) {
  for (const operation of [
    { kind: "insert", gap: { leftId: null, rightId: null }, [entriesKey]: [{ clientKey: "key", value }] },
    { kind: "update", [idKey]: "a", expectedEntityHash: hash, patch: { set: { text: "Changed" }, unset: [] } },
    { kind: "delete", [idKey]: "a", expectedEntityHash: hash },
    { kind: "move", [idKey]: "a", expectedEntityHash: hash, gap: { leftId: null, rightId: "b" } },
  ]) {
    test(`parses ${idKey} ${operation.kind} when its tagged variant is complete`, () => {
      // Given / When
      const result = schema.parse(operation);
      // Then
      assert.deepEqual(result, operation);
    });
  }
  for (const patch of [{ set: { text: "x" }, unset: ["text"] }, { set: {}, unset: ["text"] },
    { set: { id: "new" }, unset: [] }, { set: {}, unset: ["cond"] }, { set: {}, unset: ["when", "when"] }]) {
    test(`rejects forbidden patch for ${idKey} when fields overlap or escape the allowlist`, () => {
      // Given / When / Then
      assert.equal(schema.safeParse({ kind: "update", [idKey]: "a", expectedEntityHash: hash, patch }).success, false);
    });
  }
}
for (const exit of [{ kind: "next", sceneId: "b" }, { kind: "planned", sceneId: "b" }, { kind: "ending", title: "End" },
  { kind: "choices", choices: [{ kind: "existing", choiceId: "c", expectedEntityHash: hash }, { kind: "new", clientKey: "key", value: { text: "Go", next: "b" } }] }]) {
  test(`parses ${exit.kind} when the scene exit is exclusive`, () => {
    // Given / When
    const result = sceneExitSchema.parse(exit);
    // Then
    assert.deepEqual(result, exit);
  });
}

test("preserves null and typed cues when a line is updated", () => {
  // Given
  const patch = { set: { speaker: null, cgUrl: null, bgm: null, voice: `/assets/user/${hash}.mp3`,
    sprites: [{ slot: "center", character: "hero", poseUrl: null }], when: { compare: [{ flag: "score", op: "gte", value: 1 }] } }, unset: ["expression"] };
  // When
  const result = lineOperationSchema.parse({ kind: "update", lineId: "a", expectedEntityHash: hash, patch });
  // Then
  assert.deepEqual(result, { kind: "update", lineId: "a", expectedEntityHash: hash, patch });
});

test("rejects expanded batches when nested inserts exceed one hundred changes", () => {
  // Given
  const operation = { kind: "insert", gap: { leftId: null, rightId: null }, lines: Array.from({ length: 51 }, (_, index) => ({ clientKey: String(index), value: { speaker: null, text: "x" } })) };
  const second = { ...operation, lines: operation.lines.map(entry => ({ ...entry, clientKey: `second-${entry.clientKey}` })) };
  // When / Then
  assert.equal(toolArgumentsSchemas.patch_lines.safeParse({ sceneId: "s", operations: [operation, second] }).success, false);
});

test("rejects state declarations when the same ID appears in two groups", () => {
  // Given / When
  const result = toolArgumentsSchemas.patch_state.safeParse({ expectedStateHash: hash,
    declare: [{ id: "x", value: 1 }], setInitial: [{ id: "x", expectedValue: 1, value: 2 }], remove: [] });
  // Then
  assert.equal(result.success, false);
});
