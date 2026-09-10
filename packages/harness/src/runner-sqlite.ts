import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "./canonical.js";
import { parseDto } from "./primitives.js";
import { leaseSchema, runnerSnapshotSchema } from "./runner-contracts.js";
import type { Lease, RunnerSnapshot, RunnerStore } from "./runner-contracts.js";

/** SQLite ledger. WAL/foreign_keys/synchronous FULL/busy_timeout 5000. JSON snapshots at the runner boundary. */
export class SqliteRunnerStore implements RunnerStore {
  private readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "harness.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
      CREATE TABLE IF NOT EXISTS leases (scope TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));`);
  }
  close(): void { this.db.close(); }
  transaction<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  list(): readonly string[] {
    return this.db.prepare("SELECT id FROM snapshots").all().map(row => {
      if (typeof row.id !== "string") throw new Error("CORRUPT_RECORD");
      return row.id;
    });
  }
  load(runId: string): RunnerSnapshot | null {
    const row = this.db.prepare("SELECT body FROM snapshots WHERE id=?").get(runId);
    if (row === undefined) return null;
    if (typeof row.body !== "string") throw new Error("CORRUPT_RECORD");
    return parseDto(runnerSnapshotSchema, JSON.parse(row.body));
  }
  save(snapshot: RunnerSnapshot): void {
    const parsed = parseDto(runnerSnapshotSchema, JSON.parse(canonicalJson(snapshot)));
    this.db.prepare("INSERT INTO snapshots VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body")
      .run(parsed.run.id, canonicalJson(parsed));
  }
  loadLease(scopeHash: string): Lease | null {
    const row = this.db.prepare("SELECT body FROM leases WHERE scope=?").get(scopeHash);
    if (row === undefined) return null;
    if (typeof row.body !== "string") throw new Error("CORRUPT_RECORD");
    return parseDto(leaseSchema, JSON.parse(row.body));
  }
  saveLease(lease: Lease): void {
    const parsed = parseDto(leaseSchema, JSON.parse(canonicalJson(lease)));
    this.db.prepare("INSERT INTO leases VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET body=excluded.body")
      .run(parsed.scopeHash, canonicalJson(parsed));
  }
  loadReceipt(requestId: string): { readonly payloadHash: string; readonly snapshot: RunnerSnapshot } | null {
    const row = this.db.prepare("SELECT payload_hash,body FROM receipts WHERE id=?").get(requestId);
    if (row === undefined) return null;
    if (typeof row.payload_hash !== "string" || typeof row.body !== "string") throw new Error("CORRUPT_RECORD");
    return { payloadHash: row.payload_hash, snapshot: parseDto(runnerSnapshotSchema, JSON.parse(row.body)) };
  }
  saveReceipt(requestId: string, payloadHash: string, snapshot: RunnerSnapshot): void {
    this.db.prepare("INSERT INTO receipts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload_hash=excluded.payload_hash,body=excluded.body")
      .run(requestId, payloadHash, canonicalJson(parseDto(runnerSnapshotSchema, JSON.parse(canonicalJson(snapshot)))));
  }
}
