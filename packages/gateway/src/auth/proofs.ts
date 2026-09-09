import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { storedProbeProof } from "../cca/capabilities.js";
import type { CapabilityProof } from "../cca/capabilities.js";
import type { CounterObservation } from "../cca/capability-binding.js";
import { CAPABILITY_PROOF_FILE, PROVIDER } from "../config.js";

export type CapabilityProofRecord = {
  readonly proofs: readonly CapabilityProof[];
  readonly counters: readonly CounterObservation[];
};

export interface CapabilityProofStore {
  read(): Promise<CapabilityProofRecord>;
  write(record: CapabilityProofRecord): Promise<void>;
}

const EMPTY: CapabilityProofRecord = { proofs: [], counters: [] };
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    items.push(entry);
  }
  return items;
}

function readProof(value: unknown): CapabilityProof | null {
  if (!isPlainRecord(value)) return null;
  const modelId = value["modelId"];
  const contextHash = value["contextHash"];
  const evidenceHash = value["evidenceHash"];
  const observedAt = value["observedAt"];
  const requestHashes = readStringArray(value["requestHashes"]);
  const responseHashes = readStringArray(value["responseHashes"]);
  if (typeof modelId !== "string" || typeof contextHash !== "string" || typeof evidenceHash !== "string") return null;
  if (typeof observedAt !== "string" || requestHashes === null || responseHashes === null) return null;
  try {
    return storedProbeProof({
      modelId, contextHash, evidenceHash, observedAt, requestHashes, responseHashes,
      text: value["text"] === true, tools: value["tools"] === true, opaqueRoundtrip: value["opaqueRoundtrip"] === true,
      imageOutput: value["imageOutput"] === true, imageReference: value["imageReference"] === true,
    });
  } catch {
    return null;
  }
}

function readCounter(value: unknown): CounterObservation | null {
  if (!isPlainRecord(value)) return null;
  const modelId = value["modelId"];
  const contextHash = value["contextHash"];
  const exactUsage = value["exactUsage"];
  if (typeof modelId !== "string" || modelId.trim() === "") return null;
  if (typeof contextHash !== "string" || !HASH_PATTERN.test(contextHash)) return null;
  if (typeof exactUsage !== "boolean") return null;
  return { modelId, contextHash, exactUsage };
}

function parseRecord(raw: unknown): CapabilityProofRecord {
  if (!isPlainRecord(raw)) return EMPTY;
  const provider = raw[PROVIDER];
  if (!isPlainRecord(provider)) return EMPTY;
  const proofs = Array.isArray(provider["proofs"])
    ? provider["proofs"].flatMap((item) => {
      const proof = readProof(item);
      return proof === null ? [] : [proof];
    })
    : [];
  const counters = Array.isArray(provider["counters"])
    ? provider["counters"].flatMap((item) => {
      const counter = readCounter(item);
      return counter === null ? [] : [counter];
    })
    : [];
  return { proofs, counters };
}

export function createFileProofStore(path: string = CAPABILITY_PROOF_FILE): CapabilityProofStore {
  return {
    async read() {
      try {
        return parseRecord(JSON.parse(await readFile(path, "utf8")));
      } catch {
        return EMPTY;
      }
    },
    async write(record) {
      let store: Record<string, unknown> = {};
      try {
        const raw: unknown = JSON.parse(await readFile(path, "utf8"));
        if (isPlainRecord(raw)) store = raw;
      } catch {
        store = {};
      }
      store[PROVIDER] = { proofs: record.proofs, counters: record.counters };
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

export function createMemoryProofStore(initial: CapabilityProofRecord = EMPTY): CapabilityProofStore {
  let current = initial;
  return {
    async read() {
      return current;
    },
    async write(record) {
      current = record;
    },
  };
}
