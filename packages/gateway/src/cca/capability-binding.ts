import type { ModelEntry } from "./client.js";

export type CounterObservation = {
  readonly modelId: string;
  readonly contextHash: string;
  readonly exactUsage: boolean;
};

export type TokenBindingFields = {
  readonly counterSupport: "exact" | "unsupported";
  readonly tokenWindowMode: "input-only" | "combined" | "unknown";
  readonly inputTokenLimit: number | null;
  readonly outputTokenLimit: number | null;
  readonly combinedTokenLimit: number | null;
};

function limitOf(value: number | undefined): number | null {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : null;
}

export function observedExactUsage(
  counters: readonly CounterObservation[],
  modelId: string,
  contextHash: string,
): boolean {
  return counters.some((item) => item.modelId === modelId && item.contextHash === contextHash && item.exactUsage);
}

/** Catalogue supplies window/limits. Exact support requires observed usage, never a guessed counter. */
export function tokenBindingFields(entry: ModelEntry | undefined, exactUsage: boolean): TokenBindingFields {
  const mode = entry?.tokenWindowMode;
  return {
    counterSupport: exactUsage ? "exact" : "unsupported",
    tokenWindowMode: mode === "input-only" || mode === "combined" ? mode : "unknown",
    inputTokenLimit: limitOf(entry?.inputTokenLimit),
    outputTokenLimit: limitOf(entry?.outputTokenLimit),
    combinedTokenLimit: limitOf(entry?.combinedTokenLimit),
  };
}
