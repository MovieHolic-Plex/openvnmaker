import { HarnessError, hashSchema } from "./primitives.js";
import type { Sha256 } from "./primitives.js";

/** Canonical UTF-8 JSON: lexical object keys, stable arrays, omitted undefined object fields. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null) return "null";
    switch (typeof item) {
      case "boolean": case "string": return JSON.stringify(item);
      case "number":
        if (!Number.isFinite(item)) throw new HarnessError("INVALID_CANONICAL_VALUE");
        return JSON.stringify(item);
      case "object": {
        if (ancestors.has(item)) throw new HarnessError("INVALID_CANONICAL_VALUE");
        ancestors.add(item);
        try {
          if (Array.isArray(item)) {
            return `[${Array.from(item, element => encode(element)).join(",")}]`;
          }
          if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
            throw new HarnessError("INVALID_CANONICAL_VALUE");
          }
          if (Object.getOwnPropertySymbols(item).length > 0) throw new HarnessError("INVALID_CANONICAL_VALUE");
          const fields = Object.entries(Object.getOwnPropertyDescriptors(item)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
          const parts: string[] = [];
          for (const [key, descriptor] of fields) {
            if (!descriptor.enumerable) continue;
            if (descriptor.get || descriptor.set) throw new HarnessError("INVALID_CANONICAL_VALUE");
            const field: unknown = descriptor.value;
            if (field !== undefined) parts.push(`${JSON.stringify(key)}:${encode(field)}`);
          }
          return `{${parts.join(",")}}`;
        } finally { ancestors.delete(item); }
      }
      default: throw new HarnessError("INVALID_CANONICAL_VALUE");
    }
  }
  return encode(value);
}
export function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson(value));
}
export async function canonicalHash(value: unknown): Promise<Sha256> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", canonicalBytes(value));
  return hashSchema.parse(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""));
}
