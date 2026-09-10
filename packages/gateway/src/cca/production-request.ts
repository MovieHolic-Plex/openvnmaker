import { z } from "../../../harness/node_modules/zod/index.js";
import { PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID } from "./capabilities.js";
import { TEXT_THINKING_CONFIG } from "../config.js";
import type {
  ProductionCounterIncludes,
  ProductionEnvelope,
  ProductionRequestBuild,
  ProductionRequestInput,
} from "./production-types.js";
import { readArray, readObject } from "./production-util.js";

export const productionEnvelopeSchema = z.strictObject({
  project: z.string().min(1),
  model: z.string().min(1),
  request: z.strictObject({
    contents: z.array(z.unknown()).min(1),
    generationConfig: z.record(z.string(), z.unknown()),
    tools: z.unknown().optional(),
    toolConfig: z.unknown().optional(),
    systemInstruction: z.unknown().optional(),
    safetySettings: z.unknown().optional(),
  }),
  requestType: z.literal("agent"),
  requestId: z.string().min(1),
  userAgent: z.literal("antigravity"),
}).readonly();

function inspectPart(part: unknown, includes: { text: boolean; opaque: boolean; images: boolean }): void {
  const obj = readObject(part);
  if (obj === undefined) return;
  if (typeof obj["text"] === "string") includes.text = true;
  if (readObject(obj["inlineData"]) !== undefined || readObject(obj["inline_data"]) !== undefined) includes.images = true;
  const functionCall = readObject(obj["functionCall"]);
  if (typeof obj["thoughtSignature"] === "string" || functionCall?.["id"] !== undefined || obj["ccaTrace"] !== undefined) {
    includes.opaque = true;
  }
}

export function inspectProductionIncludes(envelope: ProductionEnvelope): ProductionCounterIncludes {
  const flags = { text: false, opaque: false, images: false };
  const contents = envelope.request.contents;
  for (const content of contents) {
    const row = readObject(content);
    for (const part of readArray(row?.["parts"])) inspectPart(part, flags);
  }
  return {
    text: flags.text,
    tools: envelope.request.tools !== undefined,
    history: contents.length > 1,
    opaque: flags.opaque,
    images: flags.images,
  };
}

export function validateProductionEnvelope(input: unknown): ProductionRequestBuild {
  const parsed = productionEnvelopeSchema.safeParse(input);
  if (!parsed.success) return { kind: "capability", reason: "REQUEST_SIGNATURE" };
  const model = parsed.data.model;
  if (model !== PRODUCTION_TEXT_MODEL_ID && model !== PRODUCTION_IMAGE_MODEL_ID) {
    return { kind: "capability", reason: "MODEL_MISMATCH" };
  }
  const request = parsed.data.request;
  const envelope: ProductionEnvelope = {
    project: parsed.data.project,
    model,
    request: {
      contents: request.contents,
      generationConfig: request.generationConfig,
      ...(request.tools === undefined ? {} : { tools: request.tools }),
      ...(request.toolConfig === undefined ? {} : { toolConfig: request.toolConfig }),
      ...(request.systemInstruction === undefined ? {} : { systemInstruction: request.systemInstruction }),
      ...(request.safetySettings === undefined ? {} : { safetySettings: request.safetySettings }),
    },
    requestType: "agent",
    requestId: parsed.data.requestId,
    userAgent: "antigravity",
  };
  return { kind: "ok", envelope, includes: inspectProductionIncludes(envelope), wireBody: JSON.stringify(envelope) };
}

export function buildProductionRequest(input: ProductionRequestInput): ProductionRequestBuild {
  if (input.kind === "text" && input.model !== PRODUCTION_TEXT_MODEL_ID) {
    return { kind: "capability", reason: "MODEL_MISMATCH" };
  }
  if (input.kind === "image" && input.model !== PRODUCTION_IMAGE_MODEL_ID) {
    return { kind: "capability", reason: "MODEL_MISMATCH" };
  }
  const generationConfig: Record<string, unknown> = input.kind === "image"
    ? { responseModalities: ["IMAGE"], candidateCount: 1 }
    : {
        maxOutputTokens: input.maxOutputTokens ?? 8192,
        temperature: 0.4,
        candidateCount: 1,
        thinkingConfig: { ...TEXT_THINKING_CONFIG },
      };
  return validateProductionEnvelope({
    project: input.projectId,
    model: input.model,
    request: {
      contents: input.contents,
      generationConfig,
      ...(input.tools === undefined ? {} : { tools: input.tools }),
    },
    requestType: "agent",
    requestId: input.requestId,
    userAgent: "antigravity",
  });
}

export function appendReplayTurn(
  contents: readonly unknown[],
  replayParts: readonly unknown[],
  responses: readonly { readonly name: string; readonly response: unknown }[],
): readonly unknown[] {
  return [
    ...contents,
    { role: "model", parts: replayParts },
    { role: "user", parts: responses.map((row) => ({ functionResponse: { name: row.name, response: row.response } })) },
  ];
}
