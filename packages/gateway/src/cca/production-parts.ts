import { inspectJsonFragment } from "./production-json.js";
import type { CompleteFunctionCall, ProductionTurnResult, SseRemainder } from "./production-types.js";
import { assertNever, isPlainObject, readArray, readObject } from "./production-util.js";

const CONTEXT_PATTERN = /context|token count|too (?:long|large)|exceed/i;

type Slot = { readonly kind: "call"; part: Record<string, unknown>; callId: string | undefined } | { readonly kind: "other"; part: Record<string, unknown> };

export function isContextErrorPayload(status: number, body: string, error: Record<string, unknown> | undefined): boolean {
  if (status === 400 && CONTEXT_PATTERN.test(body)) return true;
  if (error === undefined) return false;
  const message = error["message"];
  const code = error["status"];
  const text = `${typeof code === "string" ? code : ""} ${typeof message === "string" ? message : ""}`;
  return CONTEXT_PATTERN.test(text);
}

function mergeArgs(previous: unknown, incoming: unknown): unknown {
  if (typeof incoming === "string") {
    const prefix = typeof previous === "string" ? previous : previous === undefined ? "" : JSON.stringify(previous);
    return `${prefix}${incoming}`;
  }
  if (isPlainObject(incoming)) {
    return isPlainObject(previous) ? { ...previous, ...incoming } : incoming;
  }
  return incoming;
}

function mergeCallPart(base: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const baseCall = readObject(base["functionCall"]) ?? {};
  const incomingCall = readObject(incoming["functionCall"]) ?? {};
  const functionCall: Record<string, unknown> = { ...baseCall };
  for (const key of Object.keys(incomingCall)) {
    const value = incomingCall[key];
    if (key === "args") functionCall["args"] = mergeArgs(functionCall["args"], value);
    else if (functionCall[key] === undefined) functionCall[key] = value;
  }
  const next: Record<string, unknown> = { ...base, functionCall };
  for (const key of Object.keys(incoming)) {
    if (key === "functionCall" || key === "thought") continue;
    if (next[key] === undefined) next[key] = incoming[key];
  }
  return next;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function completeCall(part: Record<string, unknown>): { readonly kind: "complete"; readonly call: CompleteFunctionCall } | { readonly kind: "incomplete" } | { readonly kind: "invalid" } {
  const functionCall = readObject(part["functionCall"]);
  if (functionCall === undefined) return { kind: "invalid" };
  const name = functionCall["name"];
  if (typeof name !== "string" || name === "") return { kind: "incomplete" };
  const args = functionCall["args"];
  if (args === undefined) return { kind: "incomplete" };
  let parsed: Record<string, unknown>;
  if (typeof args === "string") {
    const inspected = inspectJsonFragment(args);
    switch (inspected.kind) {
      case "incomplete":
        return { kind: "incomplete" };
      case "invalid":
        return { kind: "invalid" };
      case "complete":
        if (!isPlainObject(inspected.value)) return { kind: "invalid" };
        parsed = inspected.value;
        break;
      default:
        return assertNever(inspected);
    }
  } else if (isPlainObject(args)) {
    parsed = args;
  } else {
    return { kind: "invalid" };
  }
  const id = optionalString(functionCall["id"]);
  const thoughtSignature = optionalString(part["thoughtSignature"]);
  return {
    kind: "complete",
    call: {
      name,
      args: parsed,
      ...(id === undefined ? {} : { id }),
      ...(thoughtSignature === undefined ? {} : { thoughtSignature }),
    },
  };
}

function usageFrom(metadata: Record<string, unknown> | undefined): { readonly knownInputUsage: number; readonly knownOutputUsage: number } | null {
  if (metadata === undefined) return null;
  const input = metadata["promptTokenCount"] ?? metadata["inputTokenCount"];
  const output = metadata["candidatesTokenCount"] ?? metadata["outputTokenCount"];
  if (typeof input !== "number" || typeof output !== "number" || !Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { knownInputUsage: input, knownOutputUsage: output };
}

export function createTurnAccumulator(): {
  add(value: unknown): void;
  finalize(remainder: SseRemainder, onFunctionCall: ((call: CompleteFunctionCall) => void) | undefined): ProductionTurnResult;
} {
  const slots: Slot[] = [];
  let finishReason: string | undefined;
  let usageMetadata: Record<string, unknown> | undefined;
  let bandError: Record<string, unknown> | undefined;

  function addPart(value: unknown): void {
    const part = readObject(value);
    if (part === undefined) return;
    if (part["thought"] === true) return;
    const functionCall = readObject(part["functionCall"]);
    if (functionCall === undefined) {
      slots.push({ kind: "other", part: { ...part } });
      return;
    }
    const callId = optionalString(functionCall["id"]);
    const existing = callId === undefined
      ? [...slots].reverse().find((slot) => slot.kind === "call" && completeCall(slot.part).kind !== "complete")
      : slots.find((slot) => slot.kind === "call" && slot.callId === callId);
    if (existing !== undefined && existing.kind === "call") {
      existing.part = mergeCallPart(existing.part, part);
      if (existing.callId === undefined) existing.callId = callId;
      return;
    }
    slots.push({ kind: "call", part: { ...part }, callId });
  }

  return {
    add(value: unknown): void {
      const root = readObject(value);
      if (root === undefined) return;
      const error = readObject(root["error"]);
      if (error !== undefined) {
        bandError = error;
        return;
      }
      const response = readObject(root["response"]);
      if (response === undefined) return;
      const usage = readObject(response["usageMetadata"]);
      if (usage !== undefined) usageMetadata = usage;
      for (const candidate of readArray(response["candidates"])) {
        const row = readObject(candidate);
        if (row === undefined) continue;
        if (typeof row["finishReason"] === "string") finishReason = row["finishReason"];
        const content = readObject(row["content"]);
        for (const part of readArray(content?.["parts"])) addPart(part);
      }
    },
    finalize(remainder: SseRemainder, onFunctionCall: ((call: CompleteFunctionCall) => void) | undefined): ProductionTurnResult {
      if (bandError !== undefined) {
        return isContextErrorPayload(200, "", bandError)
          ? { kind: "provider-context-exceeded" }
          : { kind: "unknown", dispatchCount: 0 };
      }
      switch (remainder) {
        case "invalid":
          return { kind: "unknown", dispatchCount: 0 };
        case "incomplete":
          return { kind: "incomplete", dispatchCount: 0 };
        case "empty":
          break;
        default:
          return assertNever(remainder);
      }
      if (finishReason === "MALFORMED_FUNCTION_CALL") return { kind: "unknown", dispatchCount: 0 };
      const resolved = slots.filter((slot) => slot.kind === "call").map((slot) => completeCall(slot.part));
      if (resolved.some((row) => row.kind === "invalid")) return { kind: "unknown", dispatchCount: 0 };
      if (finishReason === undefined || resolved.some((row) => row.kind === "incomplete")) {
        return { kind: "incomplete", dispatchCount: 0 };
      }
      const calls: CompleteFunctionCall[] = [];
      for (const row of resolved) {
        if (row.kind !== "complete") return { kind: "unknown", dispatchCount: 0 };
        calls.push(row.call);
      }
      const replayParts = slots.map((slot) => slot.part);
      const text = slots
        .filter((slot) => slot.kind === "other")
        .map((slot) => slot.part["text"])
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("");
      if (onFunctionCall !== undefined) {
        for (const call of calls) onFunctionCall(call);
      }
      const usage = usageFrom(usageMetadata);
      if (usage === null) {
        return { kind: "missing-usage", text, calls, replayParts, finishReason };
      }
      return { kind: "succeeded", text, calls, replayParts, usage, finishReason };
    },
  };
}
