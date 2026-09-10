import assert from "node:assert/strict";
import test from "node:test";
import { runHarnessNative } from "./harness-native.js";

const out = ".omo/evidence/gemini-medium-game-harness/t22";

test("packaged-parity-records-conversion-and-does-not-claim-exe", async () => {
  const result = await runHarnessNative({ case: "packaged-parity", out });
  assert.equal(result.exitCode, 0);
  assert.equal(result.shippedExeVerified, false);
  assert.ok(result.status === "blocked" || result.status === "passed");
  assert.equal(result.liveProviderCalls, 0);
  assert.ok(Array.isArray(result.matrix));
  const matrix = result.matrix ?? [];
  assert.equal(matrix.length, 13);
  assert.equal(matrix.every(row => row.status !== "unsupported"), true);
  if (result.status === "blocked") {
    assert.equal(typeof result.blockedReason, "string");
  }
});

test("missing-required-asset-never-offers-an-incomplete-zip", async () => {
  const result = await runHarnessNative({ case: "missing-required-asset", out });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "passed");
  assert.equal(result.zipExists, false);
  assert.equal(result.incompleteZipOffered, false);
  assert.equal(result.releaseFailed, true);
  assert.equal(result.shippedExeVerified, false);
});
