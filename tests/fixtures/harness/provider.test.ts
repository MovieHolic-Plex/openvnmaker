import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenCounterResultSchema } from "@vnmaker/harness";
import { armEvent, EventGate } from "./barriers.js";
import { counterFixtures } from "./r4-counters.js";
import { startFixtureProvider } from "./provider.js";

test("records exact wire input when a fixture request is held before publication", async () => {
  // Given
  const fixture = await counterFixtures();
  using gate = new EventGate();
  await using provider = await startFixtureProvider(new Map([["/count", { status: 200, chunks: [JSON.stringify(fixture.exact)], beforeReply: gate }]]));
  const receipt = armEvent({ source: provider.events, event: "request:1" }, AbortSignal.timeout(5000));
  const body = JSON.stringify(fixture.payload);
  // When
  const pending = fetch(`${provider.url}/count`, { method: "POST", body, signal: AbortSignal.timeout(5000) });
  await receipt;
  await gate.arrived;
  assert.equal(provider.requests[0]?.body, body);
  gate.release();
  const response = await pending;
  // Then
  assert.equal(response.headers.get("x-vnmaker-fixture"), "synthetic");
  assert.deepEqual(tokenCounterResultSchema.parse(await response.json()), fixture.exact);
});
test("preserves opaque fragments when a stream is released at an exact chunk barrier", async () => {
  // Given
  using gate = new EventGate();
  await using provider = await startFixtureProvider(new Map([["/stream", { status: 200, contentType: "text/event-stream",
    chunks: ['data: {"functionCall":{"args":', '{"sceneId":"s001"}},"signature":"opaque=="}\n\n'], afterFirstChunk: gate }]]));
  const emitted = armEvent({ source: provider.events, event: "chunk:1:0" }, AbortSignal.timeout(5000));
  // When
  const pending = fetch(`${provider.url}/stream`, { signal: AbortSignal.timeout(5000) });
  await emitted;
  await gate.arrived;
  const response = await pending;
  const text = response.text();
  gate.release();
  // Then
  assert.equal(await text, 'data: {"functionCall":{"args":{"sceneId":"s001"}},"signature":"opaque=="}\n\n');
});
for (const [code, status] of [["auth", 401], ["quota", 429], ["transport", 503]] as const) {
  test(`preserves counter ${code} when the fixture responds with HTTP ${status}`, async () => {
    // Given
    await using provider = await startFixtureProvider(new Map([["/count", { status, chunks: [JSON.stringify({ kind: "error", code })] }]]));
    // When
    const response = await fetch(`${provider.url}/count`, { signal: AbortSignal.timeout(5000) });
    // Then
    assert.equal(response.status, status);
    assert.deepEqual(tokenCounterResultSchema.parse(await response.json()), { kind: "error", code });
  });
}
test("rejects a truncated response when a sent stream disconnects", async () => {
  // Given
  using gate = new EventGate();
  await using provider = await startFixtureProvider(new Map([["/stream", { status: 200,
    chunks: ['{"unfinished":'], afterFirstChunk: gate, disconnect: true }]]));
  const emitted = armEvent({ source: provider.events, event: "chunk:1:0" }, AbortSignal.timeout(5000));
  // When
  const pending = fetch(`${provider.url}/stream`, { signal: AbortSignal.timeout(5000) });
  await emitted;
  const response = await pending;
  const rejection = assert.rejects(response.text(), { name: "TypeError" });
  gate.release();
  // Then
  await rejection;
  assert.equal(provider.requests.length, 1);
});
test("isolates ports and request journals when two peers coexist", async () => {
  // Given
  const first = await startFixtureProvider(new Map());
  const second = await startFixtureProvider(new Map());
  try {
    assert.notEqual(first.port, second.port);
    // When
    const response = await fetch(`${first.url}/absent`, { signal: AbortSignal.timeout(5000) });
    // Then
    assert.equal(response.status, 404);
    assert.equal(first.requests.length, 1);
    assert.equal(second.requests.length, 0);
  } finally {
    await Promise.all([first[Symbol.asyncDispose](), second[Symbol.asyncDispose]()]);
  }
  assert.equal(first.receipt.closed, true);
  assert.equal(second.receipt.closed, true);
});
