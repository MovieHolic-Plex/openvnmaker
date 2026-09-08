import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("exercises actual exports when the CLI parses inserts and rejects invalid input", () => {
  // Given
  const path = fileURLToPath(new URL("../tools/smoke.ts", import.meta.url));
  // When: process exit is the completion signal; no delay or shared resources.
  const result = spawnSync(process.execPath, ["--import", "tsx", path], { encoding: "utf8", timeout: 10_000 });
  // Then: the CLI itself asserts user-visible semantics against the real package.
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.error, undefined);
});
