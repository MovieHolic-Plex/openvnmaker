import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../src/canonical.js";
import { readSceneContext } from "../src/context.js";
import { toolArgumentsSchemas } from "../src/tool-contracts.js";
import { selectionSource } from "./context-selection-fixtures.js";

test("reads an original bounded window with scoped order and explicit omissions", async () => {
  // Given three source lines and a one-line window after the first.
  const source = await selectionSource();
  const args = toolArgumentsSchemas.read_scene.parse({
    sceneId: "start", afterLineId: "l1", limit: 1,
  });
  const expectedLines = [{ id: "l2", speaker: null, text: "Second caf\u00e9" }];
  const expectedHash = await canonicalHash(expectedLines);
  // When the source window is read.
  const result = await readSceneContext(source, args);
  // Then original content, window boundaries, order and omissions are explicit.
  assert.equal(result.kind, "ready");
  assert.deepEqual(result.lines, expectedLines);
  assert.deepEqual(result.window, {
    sceneId: "start", lineIds: ["l2"], hash: expectedHash,
  });
  assert.equal(result.beforeLineId, "l1");
  assert.equal(result.afterLineId, "l3");
  const order = result.readSet.find(dependency => dependency.kind === "order");
  assert.deepEqual(order?.ids, ["l1", "l2", "l3"]);
  assert.deepEqual(result.excluded, [
    {
      target: { kind: "line", sceneId: "start", lineId: "l1" },
      reason: "OUTSIDE_WINDOW",
    },
    {
      target: { kind: "line", sceneId: "start", lineId: "l3" },
      reason: "OUTSIDE_WINDOW",
    },
  ]);
});

test("rejects a read anchor that exists only in another scene", async () => {
  // Given an anchor belonging to a different scene.
  const source = await selectionSource();
  const args = toolArgumentsSchemas.read_scene.parse({
    sceneId: "start", afterLineId: "other-only", limit: 1,
  });
  // When that scoped window is requested.
  const result = await readSceneContext(source, args);
  // Then the reader cannot silently retarget it.
  assert.deepEqual(result, { kind: "blocked", reason: "STALE_TARGET" });
});
