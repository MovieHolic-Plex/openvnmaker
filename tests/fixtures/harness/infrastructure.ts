import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { tokenCounterResultSchema } from "@vnmaker/harness";
import { armEvent, EventGate } from "./barriers.js";
import { probeIndexedDb } from "./indexeddb.js";
import { startFixtureProvider } from "./provider.js";
import { exerciseProcess } from "./process.js";
import type { Sandbox } from "./sandbox.js";

/** Real loopback HTTP, child IPC/SQLite and browser IDB; no external provider. */
export async function exerciseInfrastructure(sandbox: Sandbox) {
  using gate = new EventGate();
  const provider = await startFixtureProvider(new Map([
    ["/", { status: 200, contentType: "text/html", chunks: ["<!doctype html><title>Synthetic fixture origin</title>"] }],
    ["/count", { status: 200, chunks: ['{"kind":"unsupported"}'], beforeReply: gate }],
  ]));
  let browserClosed = false;
  try {
    const requested = armEvent({ source: provider.events, event: "request:1" }, AbortSignal.timeout(10000));
    const response = fetch(`${provider.url}/count`, { method: "POST", body: '{"synthetic":true}', signal: AbortSignal.timeout(10000) });
    await requested;
    await gate.arrived;
    assert.equal(provider.requests[0]?.body, '{"synthetic":true}', "HTTP_WIRE_RECEIPT");
    gate.release();
    const counter = tokenCounterResultSchema.parse(await (await response).json());
    assert.equal(counter.kind, "unsupported", "HTTP_COUNTER_KIND");
    const processReceipt = await exerciseProcess(sandbox);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(provider.url, { waitUntil: "load", timeout: 10000 });
      const committed = await page.evaluate(probeIndexedDb, { databaseName: `${sandbox.databaseName}-commit`, action: "commit" } as const);
      assert.deepEqual([committed.event, committed.value], ["complete", "committed-value"], "IDB_COMPLETE_BARRIER");
      const aborted = await page.evaluate(probeIndexedDb, { databaseName: `${sandbox.databaseName}-abort`, action: "abort" } as const);
      assert.deepEqual([aborted.event, aborted.value], ["abort", null], "IDB_ABORT_ROLLBACK");
      return { process: processReceipt, indexedDB: [committed, aborted],
        get cleanup() { return { provider: provider.receipt, browserClosed }; } };
    } finally {
      await browser.close();
      browserClosed = true;
    }
  } finally { await provider[Symbol.asyncDispose](); }
}
