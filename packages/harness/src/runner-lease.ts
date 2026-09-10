import { canonicalHash } from "./canonical.js";
import { counterSchema, HarnessError, uuidSchema } from "./primitives.js";
import type { Sha256 } from "./primitives.js";
import { LEASE_DURATION_MS } from "./runner-contracts.js";
import type { Lease, RunnerStore } from "./runner-contracts.js";

export async function leaseScopeHash(accountScope: string, providerProjectId: string): Promise<Sha256> {
  return canonicalHash({ accountScope, providerProjectId });
}

export function isLiveLease(lease: Lease, now: number, holderId: string, epoch: number): boolean {
  return lease.expiresAt > now && lease.holderId === holderId && lease.epoch === epoch;
}

export function acquireLease(store: RunnerStore, scopeHash: Sha256, holderId: string, now: number): Lease {
  const holder = uuidSchema.parse(holderId);
  const current = store.loadLease(scopeHash);
  if (current !== null && current.expiresAt > now) {
    if (current.holderId !== holder) throw new HarnessError("RUNNER_UNAVAILABLE");
    return renewLease(store, current, now);
  }
  const epoch = counterSchema.min(1).parse(current === null ? 1 : current.epoch + 1);
  const lease: Lease = { scopeHash, holderId: holder, epoch, expiresAt: counterSchema.parse(now + LEASE_DURATION_MS) };
  store.saveLease(lease);
  return lease;
}

export function renewLease(store: RunnerStore, lease: Lease, now: number): Lease {
  const proposed = now + LEASE_DURATION_MS;
  const expiresAt = counterSchema.parse(lease.expiresAt > proposed ? lease.expiresAt : proposed);
  const next = { ...lease, expiresAt };
  store.saveLease(next);
  return next;
}
