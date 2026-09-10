import { canonicalHash } from "./canonical.js";
import { choiceSchema } from "./content-contracts.js";
import type { sceneSchema } from "./content-contracts.js";
import type { SceneExit } from "./operation-contracts.js";
import { choiceIdForClientKey } from "./operations-list.js";
import type { CandidateToolInput } from "./operations.js";
import { assertNever } from "./primitives.js";
import type { ChoiceId, HarnessErrorCode } from "./primitives.js";

type SceneData = ReturnType<typeof sceneSchema.parse>;
export type AssignedChoice = {
  readonly clientKey: string;
  readonly choiceId: ChoiceId;
};
type ExitResult =
  | {
    readonly ok: true;
    readonly scene: SceneData;
    readonly assignedChoices: readonly AssignedChoice[];
  }
  | { readonly ok: false; readonly code: HarnessErrorCode };

export async function applySceneExit(
  input: Pick<CandidateToolInput, "candidate" | "unitId">,
  scene: SceneData,
  exit: SceneExit,
): Promise<ExitResult> {
  const actual = new Set(input.candidate.script.scenes.map(row => row.id));
  actual.add(scene.id);
  const planned = new Set(input.candidate.productionDocument.outline.scenes.map(row => row.id));
  const replacement = { ...scene };
  for (const field of ["next", "choices", "ending"]) Reflect.deleteProperty(replacement, field);
  const assignedChoices: AssignedChoice[] = [];

  switch (exit.kind) {
    case "next":
      if (!actual.has(exit.sceneId)) return { ok: false, code: "INVALID_OPERATION" };
      replacement.next = exit.sceneId;
      break;
    case "planned":
      if (!planned.has(exit.sceneId)) return { ok: false, code: "INVALID_OPERATION" };
      replacement.next = exit.sceneId;
      break;
    case "ending":
      replacement.ending = exit.title;
      break;
    case "choices": {
      const choices: ReturnType<typeof choiceSchema.parse>[] = [];
      for (const entry of exit.choices) {
        switch (entry.kind) {
          case "existing": {
            const current = scene.choices?.find(choice => choice.id === entry.choiceId);
            if (!current || await canonicalHash(current) !== entry.expectedEntityHash) {
              return { ok: false, code: "STALE_TARGET" };
            }
            choices.push(current);
            break;
          }
          case "new": {
            const id = await choiceIdForClientKey({
              candidateId: input.candidate.ref.candidateId,
              unitId: input.unitId, sceneId: scene.id, clientKey: entry.clientKey,
            });
            if (scene.choices?.some(choice => choice.id === id)) {
              return { ok: false, code: "ID_PAYLOAD_CONFLICT" };
            }
            const parsed = choiceSchema.safeParse({ ...entry.value, id });
            if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
            choices.push(parsed.data);
            assignedChoices.push({ clientKey: entry.clientKey, choiceId: id });
            break;
          }
          default: return assertNever(entry);
        }
      }
      if (choices.some(choice => !actual.has(choice.next) && !planned.has(choice.next))) {
        return { ok: false, code: "INVALID_OPERATION" };
      }
      replacement.choices = choices;
      break;
    }
    default: return assertNever(exit);
  }
  return { ok: true, scene: replacement, assignedChoices };
}
