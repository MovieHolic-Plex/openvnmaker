import type { z } from "zod";
import type { choiceSetSchema } from "./content-contracts.js";
import type { ChoiceEntry, ChoiceOperation, LineOperation } from "./operation-contracts.js";
import { assertNever } from "./primitives.js";

/** Missing legacy IDs do not participate in uniqueness checks. */
export function uniqueDefinedIdentities(identities: readonly (string | undefined)[]): boolean {
  const defined = identities.filter(identity => identity !== undefined);
  return new Set(defined).size === defined.length;
}
export function choiceEffectsCompatible(choice: Pick<z.infer<typeof choiceSetSchema>, "set" | "add">): boolean {
  return Object.keys(choice.add ?? {}).every(key => !Object.hasOwn(choice.set ?? {}, key));
}
export function choiceClientKey(entry: ChoiceEntry): string | undefined {
  switch (entry.kind) {
    case "new": return entry.clientKey;
    case "existing": return undefined;
    default: return assertNever(entry);
  }
}
export function insertClientKeys(operation: LineOperation | ChoiceOperation): readonly string[] {
  switch (operation.kind) {
    case "insert": return ("lines" in operation ? operation.lines : operation.choices).map(entry => entry.clientKey);
    case "update": case "delete": case "move": return [];
    default: return assertNever(operation);
  }
}
