import { canonicalJson } from "./canonical.js";
import type { WriteSet } from "./context-contracts.js";
import { listFieldByTool } from "./operations-list.js";
import { assertNever } from "./primitives.js";
import type { ToolEnvelope } from "./tool-contracts.js";

/** Required authority is independent of whether the resulting mutation is a no-op. */
export function requiredWriteSet(envelope: ToolEnvelope): WriteSet {
  switch (envelope.tool) {
    case "patch_lines": case "patch_choices":
      return envelope.arguments.operations.map((operation): WriteSet[number] => {
        switch (operation.kind) {
          case "update":
            return {
              target: "lineId" in operation
                ? {
                  kind: "line", sceneId: envelope.arguments.sceneId,
                  lineId: operation.lineId,
                }
                : {
                  kind: "choice", sceneId: envelope.arguments.sceneId,
                  choiceId: operation.choiceId,
                },
              fields: [...Object.keys(operation.patch.set), ...operation.patch.unset],
            };
          case "insert": case "delete": case "move":
            return {
              target: { kind: "scene", sceneId: envelope.arguments.sceneId },
              fields: [listFieldByTool[envelope.tool]],
            };
          default: return assertNever(operation);
        }
      });
    case "patch_project":
      return [{
        target: { kind: "project" },
        fields: [...Object.keys(envelope.arguments.patch.set), ...envelope.arguments.patch.unset],
      }];
    case "patch_state":
      return [
        ...envelope.arguments.declare,
        ...envelope.arguments.setInitial,
        ...envelope.arguments.remove,
      ].map(row => ({ target: { kind: "state", flagId: row.id }, fields: ["value"] }));
    case "create_scene":
      return [{ target: { kind: "scene", sceneId: envelope.arguments.sceneId }, fields: ["create"] }];
    case "delete_scene":
      return [{ target: { kind: "scene", sceneId: envelope.arguments.sceneId }, fields: ["delete"] }];
    case "set_scene":
      return [{
        target: { kind: "scene", sceneId: envelope.arguments.sceneId },
        fields: [
          ...Object.keys(envelope.arguments.patch.set), ...envelope.arguments.patch.unset,
          ...(envelope.arguments.exit === undefined ? [] : ["exit"]),
        ],
      }];
    case "upsert_character":
      return [{
        target: { kind: "character", characterId: envelope.arguments.characterId },
        fields: ["value"],
      }];
    case "propose_canon":
      return [{
        target: { kind: "canon", sectionId: envelope.arguments.sectionId },
        fields: ["proposal"],
      }];
    case "project_overview": case "search_content": case "read_scene":
    case "read_canon": case "validate_candidate":
      return [];
    case "request_art":
      return [{
        target: { kind: "asset", assetId: envelope.arguments.assetRequestId },
        fields: ["request"],
      }];
    default: return assertNever(envelope);
  }
}

export function isWriteSetAuthorized(required: WriteSet, granted: WriteSet): boolean {
  const collections = { line: "lines", choice: "choices" } as const;
  return required.every(request => request.fields.every(field =>
    granted.some(grant => {
      if (canonicalJson(grant.target) === canonicalJson(request.target)) {
        return grant.fields.includes(field);
      }
      switch (request.target.kind) {
        case "line": case "choice":
          switch (grant.target.kind) {
            case "scene":
              return grant.target.sceneId === request.target.sceneId &&
                grant.fields.includes(collections[request.target.kind]);
            case "line": case "choice": case "character": case "canon":
            case "asset": case "project": case "state": return false;
            default: return assertNever(grant.target);
          }
        case "scene": case "character": case "canon":
        case "asset": case "project": case "state": return false;
        default: return assertNever(request.target);
      }
    })));
}
