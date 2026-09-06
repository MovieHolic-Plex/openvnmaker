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
  const exited = once(child, "exit", { signal: deadline });
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
  } finally {
    if (child.connected) child.send(`stop:${sandbox.databaseName}`);
    try {
      const [code] = await exited;
      assert.equal(code, 0, `FIXTURE_PROCESS_EXIT:${output.join("")}`);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
  }
  return { pid: child.pid, databasePath: sandbox.databasePath, commit: "observed-durable", exited: true, exitCode: child.exitCode, output } as const;
}
