import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { evidencePath } from "./sandbox.js";

const path = process.argv[2];
const namespace = process.argv[3];
assert.ok(path && namespace && process.send && process.disconnect, "FIXTURE_IPC_ARGUMENTS");
const send = process.send.bind(process);
const disconnect = process.disconnect.bind(process);
const database = new DatabaseSync(evidencePath(path));
database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE receipts (id TEXT PRIMARY KEY)");
process.on("message", (message: unknown) => {
  switch (message) {
    case `prepare:${namespace}`:
      send(`prepared:${namespace}`);
      break;
    case `commit:${namespace}`:
      database.exec("BEGIN IMMEDIATE");
      database.prepare("INSERT INTO receipts VALUES (?)").run(namespace);
      database.exec("COMMIT");
      send(`committed:${namespace}`);
      break;
    case `stop:${namespace}`:
      database.close();
      disconnect();
      break;
    default:
      database.close();
      process.exitCode = 1;
      disconnect();
  }
});
