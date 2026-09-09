import { canonicalHash } from "./canonical.js";
import { sceneSchema } from "./content-contracts.js";
import { applySceneExit } from "./operations-exit.js";
import { lineIdForClientKey } from "./operations-list.js";
import type {
  CandidateToolInput, ScriptMutation, ScriptMutationResult,
} from "./operations.js";
import { assertNever } from "./primitives.js";
import { scriptSchema } from "./script-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

type SceneOperationInput = CandidateToolInput & {
  readonly envelope: Extract<ToolEnvelope, {
    readonly tool: "create_scene" | "delete_scene" | "set_scene";
  }>;
};

export async function applySceneOperation(
  input: SceneOperationInput,
): Promise<ScriptMutationResult> {
  const { candidate, envelope, authorizedWriteSet } = input;
  const sceneId = envelope.arguments.sceneId;
  let fields: readonly string[];
  switch (envelope.tool) {
    case "create_scene": fields = ["create"]; break;
    case "delete_scene": fields = ["delete"]; break;
    case "set_scene":
      fields = [
        ...Object.keys(envelope.arguments.patch.set),
        ...envelope.arguments.patch.unset,
        ...(envelope.arguments.exit === undefined ? [] : ["exit"]),
      ];
      break;
    default: return assertNever(envelope);
  }
  const authorized = fields.every(field => authorizedWriteSet.some(write => {
    switch (write.target.kind) {
      case "scene":
        return write.target.sceneId === sceneId && write.fields.includes(field);
      case "project": case "line": case "choice": case "state":
      case "character": case "canon": case "asset": return false;
      default: return assertNever(write.target);
    }
  }));
  if (!authorized) return { ok: false, code: "WRITE_SCOPE_DENIED" };
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return { ok: false, code: "STALE_HEAD" };
  }

  const current = candidate.script.scenes.find(scene => scene.id === sceneId);
  let scenes: ScriptMutation["script"]["scenes"];
  let data: ScriptMutation["data"] = null;
  let scopedReadSet: ScriptMutation["readSet"] | undefined;
  switch (envelope.tool) {
    case "create_scene": {
      const args = envelope.arguments;
      if (current) return { ok: false, code: "ID_PAYLOAD_CONFLICT" };
      if (args.planBeatId !== sceneId ||
          !candidate.productionDocument.outline.scenes.some(beat => beat.id === sceneId)) {
        return { ok: false, code: "INVALID_OPERATION" };
      }
      const allocated = await Promise.all(args.lines.map(async entry => ({
        ...entry,
        lineId: await lineIdForClientKey({
          candidateId: candidate.ref.candidateId, unitId: input.unitId,
          sceneId, clientKey: entry.clientKey,
        }),
      })));
      const base = sceneSchema.safeParse({
        id: sceneId, ...args.metadata,
        lines: allocated.map(entry => ({ ...entry.value, id: entry.lineId })),
      });
      if (!base.success) return { ok: false, code: "INVALID_OPERATION" };
      const exit = await applySceneExit(input, base.data, args.exit);
      switch (exit.ok) {
        case false: return { ok: false, code: exit.code };
        case true: {
          const parsed = sceneSchema.safeParse(exit.scene);
          if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
          const composed = scriptSchema.safeParse({
            ...candidate.script, scenes: [...candidate.script.scenes, parsed.data],
          });
          if (!composed.success) return { ok: false, code: "INVALID_OPERATION" };
          scenes = composed.data.scenes;
          data = {
            assignedLines: allocated.map(entry => ({
              clientKey: entry.clientKey, lineId: entry.lineId,
            })),
            assignedChoices: [...exit.assignedChoices],
          };
          break;
        }
        default: return assertNever(exit);
      }
      break;
    }
    case "delete_scene": {
      if (!current || await canonicalHash(current) !== envelope.arguments.expectedSceneHash) {
        return { ok: false, code: "STALE_TARGET" };
      }
      const referenced = candidate.script.start === sceneId ||
        candidate.script.scenes.some(scene => scene.id !== sceneId &&
          (scene.next === sceneId || scene.choices?.some(choice => choice.next === sceneId))) ||
        candidate.script.assets?.some(asset => asset.sceneId === sceneId);
      if (referenced) return { ok: false, code: "REFERENCED_ENTITY" };
      scenes = candidate.script.scenes.filter(scene => scene.id !== sceneId);
      break;
    }
    case "set_scene": {
      const args = envelope.arguments;
      if (!current || await canonicalHash(current) !== args.expectedSceneHash) {
        return { ok: false, code: "STALE_TARGET" };
      }
      const replacement = { ...current, ...args.patch.set };
      for (const field of args.patch.unset) Reflect.deleteProperty(replacement, field);
      const base = sceneSchema.safeParse(replacement);
      if (!base.success) return { ok: false, code: "INVALID_OPERATION" };
      let updated = base.data;
      if (args.exit !== undefined) {
        const exit = await applySceneExit(input, updated, args.exit);
        switch (exit.ok) {
          case false: return { ok: false, code: exit.code };
          case true:
            updated = exit.scene;
            data = { assignedChoices: [...exit.assignedChoices] };
            break;
          default: return assertNever(exit);
        }
      }
      const composed = scriptSchema.safeParse({
        ...candidate.script,
        scenes: candidate.script.scenes.map(scene => scene.id === sceneId ? updated : scene),
      });
      if (!composed.success) return { ok: false, code: "INVALID_OPERATION" };
      scenes = composed.data.scenes;
      if (args.exit === undefined &&
          !Object.hasOwn(args.patch.set, "sprites") &&
          !args.patch.unset.includes("sprites")) {
        scopedReadSet = [{
          kind: "entity", target: { kind: "scene", sceneId },
          hash: args.expectedSceneHash,
        }];
      }
      break;
    }
    default: return assertNever(envelope);
  }

  const parsed = scriptSchema.safeParse({ ...candidate.script, scenes });
  if (!parsed.success) return { ok: false, code: "INVALID_OPERATION" };
  return {
    ok: true,
    mutation: {
      script: parsed.data, data,
      readSet: scopedReadSet ?? [
        {
          kind: "entity", target: { kind: "project" },
          hash: await canonicalHash(candidate.script),
        },
        {
          kind: "entity", target: { kind: "canon", sectionId: "outline" },
          hash: await canonicalHash({
            kind: "outline", outline: candidate.productionDocument.outline,
          }),
        },
      ],
      writeSet: [{ target: { kind: "scene", sceneId }, fields }],
    },
  };
}
