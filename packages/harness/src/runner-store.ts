import { canonicalJson } from "./canonical.js";
import { parseDto } from "./primitives.js";
import { leaseSchema, runnerSnapshotSchema } from "./runner-contracts.js";
import type { Lease, RunnerSnapshot, RunnerStore } from "./runner-contracts.js";

function cloneSnapshot(snapshot: RunnerSnapshot): RunnerSnapshot {
  return parseDto(runnerSnapshotSchema, JSON.parse(canonicalJson(snapshot)) as unknown);
}
function cloneLease(lease: Lease): Lease {
  return parseDto(leaseSchema, JSON.parse(canonicalJson(lease)) as unknown);
}

/** In-memory durable ledger. Survives runner reconstruction; transactions roll back on throw. */
export class MemoryRunnerStore implements RunnerStore {
  private snapshots = new Map<string, RunnerSnapshot>();
  private leases = new Map<string, Lease>();
  private receipts = new Map<string, { payloadHash: string; snapshot: RunnerSnapshot }>();
  private depth = 0;
  private backup: {
    snapshots: Map<string, RunnerSnapshot>; leases: Map<string, Lease>;
    receipts: Map<string, { payloadHash: string; snapshot: RunnerSnapshot }>;
  } | null = null;

  transaction<T>(body: () => T): T {
    if (this.depth === 0) {
      this.backup = { snapshots: new Map(this.snapshots), leases: new Map(this.leases), receipts: new Map(this.receipts) };
    }
    this.depth += 1;
    try {
      const result = body();
      this.depth -= 1;
      if (this.depth === 0) this.backup = null;
      return result;
    } catch (error) {
      this.depth -= 1;
      if (this.depth === 0 && this.backup !== null) {
        this.snapshots = this.backup.snapshots;
        this.leases = this.backup.leases;
        this.receipts = this.backup.receipts;
        this.backup = null;
      }
      throw error;
    }
  }
  list(): readonly string[] { return [...this.snapshots.keys()]; }
  load(runId: string): RunnerSnapshot | null {
    const row = this.snapshots.get(runId);
    return row === undefined ? null : cloneSnapshot(row);
  }
  save(snapshot: RunnerSnapshot): void {
    const parsed = cloneSnapshot(snapshot);
    this.snapshots.set(parsed.run.id, parsed);
  }
  loadLease(scopeHash: string): Lease | null {
    const row = this.leases.get(scopeHash);
    return row === undefined ? null : cloneLease(row);
  }
  saveLease(lease: Lease): void { this.leases.set(lease.scopeHash, cloneLease(lease)); }
  loadReceipt(requestId: string): { readonly payloadHash: string; readonly snapshot: RunnerSnapshot } | null {
    const row = this.receipts.get(requestId);
    return row === undefined ? null : { payloadHash: row.payloadHash, snapshot: cloneSnapshot(row.snapshot) };
  }
  saveReceipt(requestId: string, payloadHash: string, snapshot: RunnerSnapshot): void {
    this.receipts.set(requestId, { payloadHash, snapshot: cloneSnapshot(snapshot) });
  }
}
