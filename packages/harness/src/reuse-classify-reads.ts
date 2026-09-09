import { canonicalJson } from "./canonical.js";
import { replayContextDependencies } from "./context.js";
import type { ContextSource } from "./context.js";
import type { ReadSet } from "./context-contracts.js";
import { replayInspectionQuery } from "./operations-inspect.js";
import { assertNever } from "./primitives.js";
import type { ReuseReadComparison } from "./reuse-classify.js";

/** Owner delegation only; Task8 outcomes are retained even when inspection owns a query. */
export async function compareReuseFrameReads(
  source: ContextSource,
  recorded: ReadSet,
): Promise<readonly ReuseReadComparison[]> {
  const context = await replayContextDependencies(source, recorded);
  return Promise.all(context.map(async (outcome): Promise<ReuseReadComparison> => {
    switch (outcome.kind) {
      case "unchanged": case "changed": case "missing": case "blocked":
        return { owner: "context", context: outcome, comparison: outcome.kind };
      case "unsupported": {
        const inspection = await replayInspectionQuery({
          ref: source.candidateRef, script: source.script, productionDocument: source.productionDocument,
        }, outcome.recorded);
        switch (inspection.kind) {
          case "unsupported":
            return { owner: "context", context: outcome, comparison: "unsupported" };
          case "current":
            return {
              owner: "inspection", context: outcome, inspection,
              comparison: canonicalJson(outcome.recorded) === canonicalJson(inspection.current)
                ? "unchanged" : "changed",
            };
          default: return assertNever(inspection);
        }
      }
      default: return assertNever(outcome);
    }
  }));
}
