import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { armEvent } from "./barriers.js";
import type { Sandbox } from "./sandbox.js";

export async function exerciseProcess(sandbox: Sandbox) {
  const child = fork(new URL("./process-peer.ts", import.meta.url), [sandbox.databasePath, sandbox.databaseName],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const output: string[] = [];
  child.stdout?.on("data", (data: Buffer) => output.push(data.toString()));
  child.stderr?.on("data", (data: Buffer) => output.push(data.toString()));
  const deadline = AbortSignal.timeout(10000);
  // Close is independent of the work signal and includes draining child stdio.
  const closed = Promise.withResolvers<void>();
  child.once("close", () => closed.resolve());
  const exited = once(child, "exit", { signal: deadline }).then(
    value => ({ value }), (error: unknown) => ({ error }),
  );
  let workFailure: unknown;
  try {
    const prepared = armEvent({ source: child, event: "message", accept: value => value === `prepared:${sandbox.databaseName}` }, deadline);
    child.send(`prepare:${sandbox.databaseName}`);
    await prepared;
    const committed = armEvent({ source: child, event: "message", accept: value => value === `committed:${sandbox.databaseName}` }, deadline);
    child.send(`commit:${sandbox.databaseName}`);
    await committed;
    const database = new DatabaseSync(sandbox.databasePath, { readOnly: true });
    try {
      const row = database.prepare("SELECT id FROM receipts").get();
      assert.equal(row?.["id"], sandbox.databaseName, "IPC_COMMIT_IS_DURABLE");
    } finally { database.close(); }
    if (child.connected) child.send(`stop:${sandbox.databaseName}`);
    const result = await exited;
    if ("error" in result) throw result.error;
    const [code] = result.value;
    assert.equal(code, 0, `FIXTURE_PROCESS_EXIT:${output.join("")}`);
  } catch (error: unknown) {
    workFailure = error;
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    // A fresh cleanup bound cannot inherit an already-expired work deadline.
    const cleanupTimer = setTimeout(() => closed.reject(new AggregateError(
      workFailure === undefined ? [] : [workFailure], "FIXTURE_PROCESS_CLEANUP_TIMEOUT",
    )), 5000);
    try { await closed.promise; }
    finally { clearTimeout(cleanupTimer); }
  }
  return { pid: child.pid, databasePath: sandbox.databasePath, commit: "observed-durable", exited: true, exitCode: child.exitCode, output } as const;
}
