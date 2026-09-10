import assert from "node:assert/strict";
import { test } from "node:test";
import { admitBudget, budgetAdmissionSchema, budgetRequestSchema, DEFAULT_BUDGET_LIMITS, parseToolEnvelope, unitSchema } from "@vnmaker/harness";
import { budgetInput, hash, head, insert, uuid } from "./fixtures.js";

test("rejects contradictory admission when a failed token check claims authorization", () => {
  // Given
  const valid = admitBudget(budgetRequestSchema.parse({ ...budgetInput, limits: DEFAULT_BUDGET_LIMITS }));
  // When
  const result = budgetAdmissionSchema.safeParse({ ...valid, tokenCheck: "fail" });
  // Then
  assert.equal(result.success, false);
});

test("rejects ready units when output provenance is absent", () => {
  // Given
  const unit = { id: uuid, kind: "scene-draft", status: "ready", dependencyHashes: [], autoRepairRound: 0,
    contextManifest: { sourceHead: head, inputContentHash: hash, windows: [], facts: [], readSet: [], referenceBindingHashes: [], excluded: [] } };
  // When
  const result = unitSchema.safeParse(unit);
  // Then
  assert.equal(result.success, false);
});

test("narrows tool arguments when the discriminant identifies a line patch", () => {
  // Given / When
  const parsed = parseToolEnvelope(insert);
  // Then: these property accesses must typecheck without casts.
  assert.ok(parsed.tool === "patch_lines");
  assert.equal(parsed.arguments.operations.length, 1);
  assert.equal(parsed.arguments.sceneId, "ch01-lab");
});
