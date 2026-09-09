import { z } from "zod";
import { canonicalHash, canonicalJson } from "./canonical.js";
import type { Effect } from "./lifecycle-contracts.js";
import { inspectionBindingCatalogDependency } from "./operations-inspect.js";
import { isWriteSetAuthorized, requiredWriteSet } from "./operations-scope.js";
import type { CandidateToolInput, ScriptMutationResult } from "./operations.js";
import { assertNever, errorCodeSchema, hashSchema } from "./primitives.js";
import type { HarnessErrorCode, Sha256 } from "./primitives.js";
import type { ApprovedArtBinding } from "./production-contracts.js";
import type { ToolEnvelope } from "./tool-contracts.js";

/** Prepared by the effect/admission adapter, not supplied through tool arguments. */
export type PreparedArtIntent = {
  readonly toolPayloadHash: Sha256;
  readonly effect: Extract<Effect, { readonly state: "intent" }>;
};

type ArtOperationInput = CandidateToolInput & {
  readonly preparedArt: PreparedArtIntent;
  readonly envelope: Extract<ToolEnvelope, { readonly tool: "request_art" }>;
};
type ArtOperationResult =
  | Extract<ScriptMutationResult, { readonly ok: true }>
  | { readonly ok: false; readonly code: HarnessErrorCode; readonly message: string };

export async function acknowledgeArtIntent(
  input: ArtOperationInput,
): Promise<ArtOperationResult> {
  function reject(code: HarnessErrorCode, message: string = code): ArtOperationResult {
    return { ok: false, code, message };
  }
  const { candidate, envelope, preparedArt } = input;
  if (!isWriteSetAuthorized(requiredWriteSet(envelope), input.authorizedWriteSet)) {
    return reject("WRITE_SCOPE_DENIED");
  }
  if (envelope.candidateId !== candidate.ref.candidateId ||
      envelope.expectedCandidateRevision !== candidate.ref.revision) {
    return reject("STALE_HEAD");
  }
  const toolPayloadHash = await canonicalHash({ unitId: input.unitId, envelope });
  if (preparedArt.toolPayloadHash !== toolPayloadHash) {
    return reject("ID_PAYLOAD_CONFLICT");
  }
  const { effect } = preparedArt;
  const { admission } = effect;
  if (effect.payloadHash !== admission.requestPayloadHash) {
    return reject("INVALID_OPERATION");
  }
  if (!admission.allowed) {
    switch (admission.reason) {
      case null: return reject("INVALID_OPERATION");
      case "COUNTER_AUTH": return reject("AUTH_REQUIRED", admission.reason);
      case "COUNTER_QUOTA": return reject("QUOTA", admission.reason);
      case "COUNTER_TRANSPORT": return reject("UPSTREAM", admission.reason);
      case "BOUNDED_PAYLOAD_APPROVAL_REQUIRED":
        return reject("REVIEW_REQUIRED", admission.reason);
      case "TEXT_BYTES_LIMIT": case "WIRE_BYTES_LIMIT":
      case "OUTPUT_TOKENS_LIMIT": case "IMAGE_INPUTS_LIMIT":
      case "SINGLE_IMAGE_BYTES_LIMIT": case "ALL_IMAGE_BYTES_LIMIT":
      case "IMAGE_PIXELS_LIMIT": case "REFERENCE_EDGE_LIMIT":
      case "REPAIR_ROUNDS_LIMIT":
      case "RUN_TEXTATTEMPTS_LIMIT": case "RUN_IMAGEATTEMPTS_LIMIT":
      case "RUN_COUNTREQUESTS_LIMIT":
      case "CHAPTER_TEXTATTEMPTS_LIMIT": case "CHAPTER_IMAGEATTEMPTS_LIMIT":
      case "CHAPTER_COUNTREQUESTS_LIMIT":
        return reject("LIMIT_EXCEEDED", admission.reason);
      default: {
        const code = errorCodeSchema.safeParse(admission.reason);
        return reject(code.success ? code.data : "INVALID_STATE", admission.reason);
      }
    }
  }
  const args = envelope.arguments;
  const referenceHashes = hashSchema.array().safeParse(args.referenceBindingIds);
  if (!referenceHashes.success) return reject("INVALID_INPUT");
  if (referenceHashes.data.length !== admission.images.length) {
    return reject("INVALID_OPERATION");
  }
  const referenceBindings: ApprovedArtBinding[] = [];
  if (referenceHashes.data.length > 0) {
    const catalog = await Promise.all(candidate.productionDocument.referenceBindings.map(
      async binding => ({ hash: await canonicalHash(binding), binding }),
    ));
    const byHash = new Map(catalog.map(row => [row.hash, row.binding] as const));
    for (const [index, hash] of referenceHashes.data.entries()) {
      const binding = byHash.get(hash);
      if (!binding) return reject("STALE_TARGET");
      if (admission.images[index]?.originalHash !== binding.originalHash) {
        return reject("INVALID_OPERATION");
      }
      referenceBindings.push(binding);
    }
  }
  switch (args.target.kind) {
    case "character": {
      const characterId = args.target.characterId;
      if (!candidate.script.characters.some(character => character.id === characterId)) {
        return reject("STALE_TARGET");
      }
      break;
    }
    case "scene": {
      const target = args.target;
      const scene = candidate.script.scenes.find(row => row.id === target.sceneId);
      if (!scene) {
        if (target.lineId !== undefined ||
            !candidate.productionDocument.outline.scenes.some(row => row.id === target.sceneId)) {
          return reject("STALE_TARGET");
        }
      } else if (target.lineId !== undefined && !scene.lines.some(line => line.id === target.lineId)) {
        return reject("STALE_TARGET");
      }
      break;
    }
    default: return assertNever(args.target);
  }
  const serialized: unknown = JSON.parse(canonicalJson({
    kind: "art-intent", request: args, toolPayloadHash, effect, referenceBindings,
  }));
  return {
    ok: true,
    mutation: {
      script: candidate.script,
      data: z.json().parse(serialized),
      readSet: [
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
        ...(referenceBindings.length === 0 ? [] : [
          await inspectionBindingCatalogDependency(candidate.productionDocument),
        ]),
      ],
      writeSet: [],
    },
  };
}
