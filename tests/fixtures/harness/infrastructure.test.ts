import assert from "node:assert/strict";
import { test } from "node:test";
import { createSandbox } from "./sandbox.js";
import { exerciseInfrastructure } from "./infrastructure.js";

test("observes native storage and IPC events when exercising isolated infrastructure", { timeout: 30000 }, async () => {
  // Given
  await using sandbox = await createSandbox();
  // When
  const result = await exerciseInfrastructure(sandbox);
  // Then
  assert.equal(result.process.exitCode, 0);
  assert.equal(result.cleanup.browserClosed, true);
  assert.equal(result.cleanup.provider.closed, true);
  assert.deepEqual(result.indexedDB.map(receipt => receipt.cleanup), ["database-deleted", "database-deleted"]);
});
