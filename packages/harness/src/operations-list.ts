import { parseScene } from "../../content/src/index.js";
import type { Scene } from "../../content/src/index.js";
import { canonicalHash } from "./canonical.js";
import { choiceSchema, lineSchema, sceneSchema } from "./content-contracts.js";
import type { ReadSet } from "./context-contracts.js";
import type { ToolResult } from "./lifecycle-contracts.js";
import { assertNever, choiceIdSchema, lineIdSchema } from "./primitives.js";
import type {
  CandidateId, ChoiceId, Gap, HarnessErrorCode, LineId, SceneId, UnitId,
} from "./primitives.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type ListEnvelope = Extract<ToolEnvelope, {
  readonly tool: "patch_lines" | "patch_choices";
}>;
type ListEntity =
  | ReturnType<typeof lineSchema.parse>
  | ReturnType<typeof choiceSchema.parse>;
type ListMutation = {
  readonly envelope: ListEnvelope;
  readonly scene: Scene;
  readonly candidateId: CandidateId;
  readonly unitId: UnitId;
};
type ListResult =
  | {
    readonly ok: true;
    readonly scene: Scene;
    readonly data: Extract<ToolResult, { readonly ok: true }>["data"];
    readonly readSet: ReadSet;
  }
  | { readonly ok: false; readonly code: HarnessErrorCode };

export const listFieldByTool = {
  patch_lines: "lines", patch_choices: "choices",
} as const satisfies Readonly<Record<ListEnvelope["tool"], "lines" | "choices">>;
const schemaByTool = { patch_lines: lineSchema, patch_choices: choiceSchema } as const;
type NarrativeAllocation = {
  readonly candidateId: CandidateId;
  readonly unitId: UnitId;
  readonly sceneId: SceneId;
  readonly clientKey: string;
};

export async function lineIdForClientKey(input: NarrativeAllocation): Promise<LineId> {
  return lineIdSchema.parse(`l-${await canonicalHash(input)}`);
}

export async function choiceIdForClientKey(input: NarrativeAllocation): Promise<ChoiceId> {
  return choiceIdSchema.parse(`c-${await canonicalHash(input)}`);
}

function gapIndex(
  entries: readonly { readonly id?: string | undefined }[],
  gap: Gap,
): number | undefined {
  const leftIndex = gap.leftId === null
    ? -1
    : entries.findIndex(entry => entry.id === gap.leftId);
  if (gap.leftId !== null && leftIndex === -1) return undefined;
  const index = leftIndex + 1;
  const adjacent = gap.rightId === null
    ? index === entries.length
    : entries[index]?.id === gap.rightId;
  return adjacent ? index : undefined;
}

export async function applyListOperations(input: ListMutation): Promise<ListResult> {
  const { envelope, scene } = input;
  const field = listFieldByTool[envelope.tool];
  const schema = schemaByTool[envelope.tool];
  const source = sceneSchema.safeParse(scene);
  if (!source.success) return { ok: false, code: "INVALID_OPERATION" };

  // Only this private working list changes until the entire batch is accepted.
  const entries: ListEntity[] = [...(source.data[field] ?? [])];
  const assignedLines: { readonly clientKey: string; readonly lineId: LineId }[] = [];
  const assignedChoices: { readonly clientKey: string; readonly choiceId: ChoiceId }[] = [];
  let textOnly = true;
  const initialLineReads = new Map<LineId, Extract<ReadSet[number], { readonly kind: "entity" }>>();
  for (const operation of envelope.arguments.operations) {
    switch (operation.kind) {
      case "insert": {
        textOnly = false;
        const index = gapIndex(entries, operation.gap);
        if (index === undefined) return { ok: false, code: "STALE_GAP" };
        const inserted: ListEntity[] = [];
        const additions = "lines" in operation ? operation.lines : operation.choices;
        for (const entry of additions) {
          const allocation = {
            candidateId: input.candidateId, unitId: input.unitId,
            sceneId: envelope.arguments.sceneId, clientKey: entry.clientKey,
          };
          let id: LineId | ChoiceId;
          switch (envelope.tool) {
            case "patch_lines":
              id = await lineIdForClientKey(allocation);
              assignedLines.push({ clientKey: entry.clientKey, lineId: id });
              break;
            case "patch_choices":
              id = await choiceIdForClientKey(allocation);
              assignedChoices.push({ clientKey: entry.clientKey, choiceId: id });
              break;
            default: return assertNever(envelope);
          }
          if (entries.some(existing => existing.id === id)) {
            return { ok: false, code: "ID_PAYLOAD_CONFLICT" };
          }
          const parsed = schema.safeParse({ ...entry.value, id });
          if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
          inserted.push(parsed.data);
        }
        entries.splice(index, 0, ...inserted);
        break;
      }
      case "update": case "delete": case "move": {
        const id = "lineId" in operation ? operation.lineId : operation.choiceId;
        const index = entries.findIndex(entry => entry.id === id);
        const current = entries[index];
        if (!current || await canonicalHash(current) !== operation.expectedEntityHash) {
          return { ok: false, code: "STALE_TARGET" };
        }
        switch (operation.kind) {
          case "update": {
            if ("lineId" in operation && operation.patch.unset.length === 0 &&
                Object.keys(operation.patch.set).every(key => key === "text")) {
              // The hash was just verified. Later writes to this ID have derived
              // preimages, retained in the ordered envelope rather than this frame.
              if (!initialLineReads.has(operation.lineId)) {
                initialLineReads.set(operation.lineId, {
                  kind: "entity",
                  target: {
                    kind: "line", sceneId: envelope.arguments.sceneId,
                    lineId: operation.lineId,
                  },
                  hash: operation.expectedEntityHash,
                });
              }
            } else {
              textOnly = false;
            }
            const replacement = { ...current, ...operation.patch.set };
            for (const key of operation.patch.unset) Reflect.deleteProperty(replacement, key);
            const parsed = schema.safeParse(replacement);
            if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
            entries[index] = parsed.data;
            break;
          }
          case "delete":
            textOnly = false;
            entries.splice(index, 1);
            break;
          case "move": {
            textOnly = false;
            entries.splice(index, 1);
            const destination = gapIndex(entries, operation.gap);
            if (destination === undefined) return { ok: false, code: "STALE_GAP" };
            entries.splice(destination, 0, current);
            break;
          }
          default: return assertNever(operation);
        }
        break;
      }
      default: return assertNever(operation);
    }
  }

  const parsed = sceneSchema.safeParse({ ...scene, [field]: entries });
  if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
  const dataByTool = {
    patch_lines: { assignedLines },
    patch_choices: { assignedChoices },
  };
  return {
    ok: true,
    scene: parseScene(parsed.data),
    data: dataByTool[envelope.tool],
    readSet: textOnly ? [...initialLineReads.values()] : [{
      kind: "entity",
      target: { kind: "scene", sceneId: envelope.arguments.sceneId },
      hash: await canonicalHash(scene),
    }],
  };
}
