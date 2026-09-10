import type { z } from "zod";
import type { artifactReceiptSchema, Unit } from "./lifecycle-contracts.js";
import { assertNever, hashSchema } from "./primitives.js";
import type { UnitId } from "./primitives.js";
import type { UnitProvenance } from "./reuse-contracts.js";

export type ReuseStoredOutput = {
  readonly receipt: z.infer<typeof artifactReceiptSchema>;
  readonly bytes: Uint8Array<ArrayBuffer>;
};
/** Storage/effect observations, not author approval or context validation. */
export type ReuseOutputMaterial =
  | { readonly kind: "present"; readonly output: ReuseStoredOutput }
  | { readonly kind: "missing" }
  | { readonly kind: "unknown-effect"; readonly retainedOutput: ReuseStoredOutput | null };
export type ReuseOutputVerification =
  | { readonly kind: "verified"; readonly unitId: UnitId;
      readonly artifact: z.infer<typeof artifactReceiptSchema>;
      readonly provenance: UnitProvenance }
  | { readonly kind: "unavailable"; readonly unitId: UnitId; readonly reason:
      "UNIT_NOT_READY" | "OUTPUT_MISSING" | "OUTPUT_CORRUPT" | "UNKNOWN_EFFECT" };

/** unit comes from immutable source evidence; byte verification never establishes eligibility. */
export async function verifyReuseOutputArtifact(
  unit: Unit,
  material: ReuseOutputMaterial,
): Promise<ReuseOutputVerification> {
  const unavailable = (
    reason: Extract<ReuseOutputVerification, { readonly kind: "unavailable" }>["reason"],
  ): Extract<ReuseOutputVerification, { readonly kind: "unavailable" }> => ({
    kind: "unavailable", unitId: unit.id, reason,
  });
  switch (material.kind) {
    case "missing": return unavailable("OUTPUT_MISSING");
    case "unknown-effect": return unavailable("UNKNOWN_EFFECT");
    case "present": break;
    default: return assertNever(material);
  }
  switch (unit.status) {
    case "ready": break;
    case "pending": case "running": case "failed": case "cancelled": case "blocked":
      return unavailable("UNIT_NOT_READY");
    default: return assertNever(unit);
  }
  const { receipt, bytes } = material.output;
  const expectedHash = unit.provenance.outputArtifactHash;
  if (receipt.hash !== expectedHash || receipt.bytes !== bytes.byteLength) {
    return unavailable("OUTPUT_CORRUPT");
  }
  // Hash this exact byte view, not its backing buffer or a JSON representation.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const actualHash = hashSchema.parse(Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")).join(""));
  if (actualHash !== expectedHash) return unavailable("OUTPUT_CORRUPT");
  return {
    kind: "verified", unitId: unit.id, artifact: receipt,
    provenance: unit.provenance,
  };
}
