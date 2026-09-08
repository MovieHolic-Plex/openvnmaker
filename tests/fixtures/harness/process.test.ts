import assert from "node:assert/strict";
import cp, { type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { assertNever } from "@vnmaker/harness";
import { exerciseInfrastructure } from "./infrastructure.js";
import { exerciseProcess } from "./process.js";
import { createSandbox } from "./sandbox.js";

for (const scenario of [
  { mode: "stop", exercise: exerciseProcess, name: "closes before rejecting when the stop deadline aborts" },
  { mode: "prepare", exercise: exerciseProcess, name: "preserves the work failure when preparation aborts" },
  { mode: "normal", exercise: exerciseProcess, name: "closes before returning when the child exits zero" },
  { mode: "nonzero", exercise: exerciseProcess, name: "rejects after close when the child exits nonzero" },
  { mode: "stop", exercise: exerciseInfrastructure, name: "closes before infrastructure rejects when the stop deadline aborts" },
] as const) {
  test(scenario.name, { timeout: 30000 }, async t => {
    // Given: only the fork target and work deadline are intercepted; IPC, SQLite,
    // process termination, terminal events and Sandbox disposal remain real.
    const sandbox = await createSandbox();
    const deadline = new AbortController();
    const reason = new DOMException("IPC-controlled work expiry", "TimeoutError");
    const originalFork = cp.fork;
    const originalTimeout = AbortSignal.timeout;
    const events: string[] = [];
    let child: ChildProcess | undefined;
    let closed: Promise<unknown> | undefined;
    t.mock.method(AbortSignal, "timeout", (ms: number) => ms === 10000 ? deadline.signal : originalTimeout(ms));
    t.mock.method(cp, "fork", (modulePath: Parameters<typeof cp.fork>[0], args: readonly string[], options: cp.ForkOptions) => {
      assert.match(String(modulePath), /process-peer\.ts$/);
      const owned = originalFork(new URL("./process-test-peer.ts", import.meta.url), [...args, scenario.mode], options);
      child = owned;
      closed = once(owned, "close", { signal: originalTimeout(20000) });
      owned.once("exit", () => events.push("exit"));
      owned.once("close", () => events.push("close"));
      owned.on("message", (message: unknown) => {
        if (message === `blocked:${sandbox.databaseName}`) {
          events.push("abort");
          deadline.abort(reason);
        }
      });
      return owned;
    });
    syncBuiltinESMExports();
    try {
      // When
      const result = await scenario.exercise(sandbox).then(
        value => { events.push("settled"); return { value }; },
        (error: unknown) => { events.push("settled"); return { error }; },
      );
      // Then: settlement must follow terminal events, before direct removal.
      assert.deepEqual(events.slice(-3), ["exit", "close", "settled"], "TERMINAL_CLOSE_BEFORE_SETTLEMENT");
      switch (scenario.mode) {
        case "prepare":
          assert.ok("error" in result);
          assert.equal(result.error, reason, "ORIGINAL_WORK_FAILURE");
          break;
        case "stop":
          assert.ok("error" in result && result.error instanceof Error);
          assert.equal(result.error.name, "AbortError");
          assert.equal(result.error.cause, reason);
          break;
        case "nonzero":
          assert.ok("error" in result && result.error instanceof assert.AssertionError);
          assert.equal(result.error.actual, 7);
          assert.equal(result.error.expected, 0);
          break;
        case "normal":
          assert.ok("value" in result && "exitCode" in result.value);
          assert.equal(result.value.exitCode, 0);
          break;
        default: assertNever(scenario);
      }
      await sandbox[Symbol.asyncDispose]();
    } finally {
      // Independent reaping is required even when the regression is RED.
      try {
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
        if (closed) await closed;
        if (!sandbox.receipt.removed) await sandbox[Symbol.asyncDispose]();
        const pid = child?.pid;
        assert.ok(pid);
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        await assert.rejects(access(sandbox.databasePath), { code: "ENOENT" });
        await assert.rejects(access(sandbox.root), { code: "ENOENT" });
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
    }
  });
}
