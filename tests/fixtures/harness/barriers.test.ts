import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { armEvent, EventGate } from "./barriers.js";
import { createSandbox, evidencePath } from "./sandbox.js";

test("ignores unrelated IPC messages when waiting for an exact transaction token", async () => {
  // Given
  const source = new EventEmitter();
  const signal = AbortSignal.timeout(5000);
  const received = armEvent({ source, event: "message", accept: value => value === "commit:run-1" }, signal);
  source.emit("message", "commit:run-2");
  assert.equal(source.listenerCount("message"), 1);
  // When
  source.emit("message", "commit:run-1");
  // Then
  assert.equal(await received, "commit:run-1");
  assert.equal(source.listenerCount("message"), 0);
});
test("removes subscriptions when the caller aborts a barrier", async () => {
  // Given
  const source = new EventEmitter();
  const controller = new AbortController();
  const received = armEvent({ source, event: "commit" }, controller.signal);
  const rejection = assert.rejects(received, { name: "AbortError" });
  // When
  controller.abort();
  // Then
  await rejection;
  assert.equal(source.listenerCount("commit"), 0);
});
test("holds publication when a gate has arrived but is not released", async () => {
  // Given
  using gate = new EventGate();
  let published = false;
  const work = gate.pause().then(() => { published = true; });
  await gate.arrived;
  assert.equal(published, false);
  // When
  gate.release();
  // Then
  await work;
  assert.equal(published, true);
});
test("cancels held work when its exact abort signal fires", async () => {
  // Given
  const controller = new AbortController();
  using gate = new EventGate(controller.signal);
  const rejected = assert.rejects(gate.pause(), { name: "AbortError" });
  await gate.arrived;
  // When
  controller.abort();
  // Then
  await rejected;
});
test("namespaces resources when sandboxes coexist then emits cleanup receipts", async () => {
  // Given
  const first = await createSandbox();
  const second = await createSandbox();
  assert.notEqual(first.root, second.root);
  assert.notEqual(first.databaseName, second.databaseName);
  assert.notEqual(first.databasePath, second.databasePath);
  // When
  await Promise.all([first[Symbol.asyncDispose](), second[Symbol.asyncDispose]()]);
  // Then
  assert.equal(first.receipt.removed, true);
  assert.equal(second.receipt.removed, true);
});
test("rejects output escape when a path names another worktree", () => {
  // Given / When / Then
  assert.throws(() => evidencePath("../other/.omo/out"), { message: /OUTPUT_MUST_BE_WORKTREE_OMO/ });
});
