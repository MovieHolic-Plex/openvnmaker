import assert from "node:assert/strict";
import { test } from "node:test";
import { choiceOperationSchema, choiceOperationsSchema, HarnessError, lineOperationSchema, lineOperationsSchema,
  parseToolEnvelope, sceneExitSchema, toolArgumentsSchemas } from "@vnmaker/harness";
import { hash, uuid } from "./fixtures.js";

const gap = { leftId: null, rightId: null };
const lineValue = { speaker: null, text: "One" };
const choiceValue = { text: "One", next: "start" };
const lineEntry = { clientKey: "key", value: lineValue };
const choiceEntry = { clientKey: "key", value: choiceValue };
const sceneFields = { sceneId: "start", planBeatId: "beat", metadata: { background: "title" } };
const envelope = (tool: string, args: unknown) => ({ callId: uuid, candidateId: uuid,
  expectedCandidateRevision: 0, tool, arguments: args });

for (const [name, field, value, operationSchema, operationsSchema] of [
  ["line", "lines", lineValue, lineOperationSchema, lineOperationsSchema],
  ["choice", "choices", choiceValue, choiceOperationSchema, choiceOperationsSchema],
] as const) {
  for (const [policy, secondValue] of [["different values", { ...value, text: "Two" }], ["identical values", value]] as const) {
    const first = { clientKey: "key", value };
    const second = { clientKey: "key", value: secondValue };
    test(`B3 rejects ${name} entries when duplicate client keys have ${policy}`, () => {
      // Given
      const input = { kind: "insert", gap, [field]: [first, second] };
      // When
      const result = operationSchema.safeParse(input);
      // Then
      assert.equal(result.success, false);
    });
    test(`B3 rejects ${name} insert batches when duplicate client keys have ${policy}`, () => {
      // Given
      const input = [{ kind: "insert", gap, [field]: [first] }, { kind: "insert", gap, [field]: [second] }];
      // When
      const result = operationsSchema.safeParse(input);
      // Then
      assert.equal(result.success, false);
    });
    test(`B3 rejects nested patch_${field} when duplicate client keys have ${policy}`, () => {
      // Given
      const input = envelope(`patch_${field}`, { sceneId: "start", operations: [
        { kind: "insert", gap, [field]: [first] }, { kind: "insert", gap, [field]: [second] },
      ] });
      // When / Then
      assert.throws(() => parseToolEnvelope(input), error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
    });
  }
  test(`B3 preserves ${name} entries when distinct client keys share identical values`, () => {
    // Given
    const input = [{ kind: "insert", gap, [field]: [{ clientKey: "first", value }] },
      { kind: "insert", gap, [field]: [{ clientKey: "second", value }] }];
    // When
    const result = operationsSchema.parse(input);
    // Then
    assert.deepEqual(result, input);
  });
}
for (const [policy, text] of [["different values", "Two"], ["identical values", "One"]] as const) {
  test(`B3 rejects create_scene lines when duplicate client keys have ${policy}`, () => {
    // Given
    const input = { ...sceneFields, lines: [lineEntry, { ...lineEntry, value: { ...lineValue, text } }],
      exit: { kind: "ending", title: "End" } };
    // When
    const result = toolArgumentsSchemas.create_scene.safeParse(input);
    // Then
    assert.equal(result.success, false);
  });
  const exit = { kind: "choices", choices: [{ kind: "new", ...choiceEntry },
    { kind: "new", ...choiceEntry, value: { ...choiceValue, text } }] };
  test(`B3 rejects scene exit creation when duplicate client keys have ${policy}`, () => {
    // Given
    const input = structuredClone(exit);
    // When
    const result = sceneExitSchema.safeParse(input);
    // Then
    assert.equal(result.success, false);
  });
  for (const [tool, args] of [
    ["create_scene", { ...sceneFields, lines: [{ ...lineEntry, clientKey: "line-key" }], exit }],
    ["set_scene", { sceneId: "start", expectedSceneHash: hash, patch: { set: {}, unset: [] }, exit }],
  ] as const) {
    test(`B3 rejects ${tool} choice creation when duplicate client keys have ${policy}`, () => {
      // Given
      const input = envelope(tool, args);
      // When / Then
      assert.throws(() => parseToolEnvelope(input), error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
    });
  }
}
test("B3 rejects create_scene when a line and new exit choice share a client key", () => {
  // Given: clientKey identifies creation within the unit, not an entity-kind namespace.
  const input = envelope("create_scene", { ...sceneFields, lines: [lineEntry],
    exit: { kind: "choices", choices: [{ kind: "new", ...choiceEntry }] } });
  // When / Then
  assert.throws(() => parseToolEnvelope(input), error => error instanceof HarnessError && error.code === "INVALID_OPERATION");
});
test("B3 preserves create_scene when all new keys differ and existing choices carry no key", () => {
  // Given
  const input = envelope("create_scene", { ...sceneFields, lines: [lineEntry], exit: { kind: "choices", choices: [
    { kind: "existing", choiceId: "key", expectedEntityHash: hash },
    { kind: "existing", choiceId: "other", expectedEntityHash: hash },
    { kind: "new", ...choiceEntry, clientKey: "choice-key" },
  ] } });
  // When
  const result = parseToolEnvelope(input);
  // Then
  assert.deepEqual(result, input);
});
for (const text of ["One", "Different in another call"]) {
  test(`B3 leaves durable idempotency downstream when a separate payload contains ${text}`, () => {
    // Given: prior parsing cannot create receipt state.
    const args = { ...sceneFields, lines: [lineEntry], exit: { kind: "ending", title: "End" } };
    const prior = envelope("create_scene", args);
    parseToolEnvelope(prior);
    const input = { ...prior, arguments: { ...args, lines: [{ ...lineEntry, value: { ...lineValue, text } }] } };
    // When
    const result = parseToolEnvelope(input);
    // Then
    assert.deepEqual(result, input);
  });
}
