import { canonicalHash, canonicalJson } from "./canonical.js";
import type { NewChoice, NewLine } from "./content-contracts.js";
import type { SceneExit } from "./operation-contracts.js";
import { choiceIdForClientKey, lineIdForClientKey } from "./operations-list.js";
import type { AllocationReceipt } from "./operations-receipts.js";
import type { CandidateToolInput } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { SceneId } from "./primitives.js";

type AllocationRequest = {
  readonly sceneId: SceneId;
  readonly clientKey: string;
} & (
  | { readonly kind: "line"; readonly value: NewLine }
  | { readonly kind: "choice"; readonly value: NewChoice }
);
type AllocationResult =
  | { readonly ok: true; readonly allocations: readonly AllocationReceipt[] }
  | { readonly ok: false; readonly code: "ID_PAYLOAD_CONFLICT" };

function newChoices(
  exit: SceneExit | undefined,
): readonly { readonly clientKey: string; readonly value: NewChoice }[] {
  if (exit === undefined) return [];
  switch (exit.kind) {
    case "choices":
      return exit.choices.flatMap(entry => {
        switch (entry.kind) {
          case "existing": return [];
          case "new": return [{ clientKey: entry.clientKey, value: entry.value }];
          default: return assertNever(entry);
        }
      });
    case "next": case "ending": case "planned": return [];
    default: return assertNever(exit);
  }
}

export async function prepareAllocations(input: CandidateToolInput): Promise<AllocationResult> {
  const { envelope } = input;
  const requests: AllocationRequest[] = [];
  switch (envelope.tool) {
    case "patch_lines":
      for (const operation of envelope.arguments.operations) {
        switch (operation.kind) {
          case "insert":
            requests.push(...operation.lines.map(entry => ({
              ...entry, kind: "line" as const, sceneId: envelope.arguments.sceneId,
            })));
            break;
          case "update": case "delete": case "move": break;
          default: return assertNever(operation);
        }
      }
      break;
    case "patch_choices":
      for (const operation of envelope.arguments.operations) {
        switch (operation.kind) {
          case "insert":
            requests.push(...operation.choices.map(entry => ({
              ...entry, kind: "choice" as const, sceneId: envelope.arguments.sceneId,
            })));
            break;
          case "update": case "delete": case "move": break;
          default: return assertNever(operation);
        }
      }
      break;
    case "create_scene":
      requests.push(...envelope.arguments.lines.map(entry => ({
        ...entry, kind: "line" as const, sceneId: envelope.arguments.sceneId,
      })));
      requests.push(...newChoices(envelope.arguments.exit).map(entry => ({
        ...entry, kind: "choice" as const, sceneId: envelope.arguments.sceneId,
      })));
      break;
    case "set_scene":
      requests.push(...newChoices(envelope.arguments.exit).map(entry => ({
        ...entry, kind: "choice" as const, sceneId: envelope.arguments.sceneId,
      })));
      break;
    case "project_overview": case "search_content": case "read_scene":
    case "read_canon": case "propose_canon": case "patch_project":
    case "patch_state": case "delete_scene": case "upsert_character":
    case "request_art": case "validate_candidate":
      break;
    default: return assertNever(envelope);
  }

  // A private extension is published only if the entire tool call succeeds.
  const allocations = [...input.journal.allocations];
  for (const request of requests) {
    const identity = {
      candidateId: input.candidate.ref.candidateId, unitId: input.unitId,
      sceneId: request.sceneId, clientKey: request.clientKey,
    };
    let target: AllocationReceipt["target"];
    switch (request.kind) {
      case "line":
        target = {
          kind: "line", sceneId: request.sceneId,
          lineId: await lineIdForClientKey(identity),
        };
        break;
      case "choice":
        target = {
          kind: "choice", sceneId: request.sceneId,
          choiceId: await choiceIdForClientKey(identity),
        };
        break;
      default: return assertNever(request);
    }
    const valueHash = await canonicalHash(request.value);
    const prior = allocations.find(allocation =>
      allocation.unitId === input.unitId && allocation.clientKey === request.clientKey);
    if (prior) {
      if (prior.valueHash !== valueHash || canonicalJson(prior.target) !== canonicalJson(target)) {
        return { ok: false, code: "ID_PAYLOAD_CONFLICT" };
      }
    } else {
      allocations.push({ unitId: input.unitId, clientKey: request.clientKey, target, valueHash });
    }
  }
  return { ok: true, allocations };
}
