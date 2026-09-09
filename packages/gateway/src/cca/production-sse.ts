import { inspectJsonFragment } from "./production-json.js";
import type { SseFinish, SsePushResult } from "./production-types.js";
import { assertNever } from "./production-util.js";

function dataFromBlock(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

export function createIncrementalSseParser(): {
  push(bytes: Uint8Array): SsePushResult;
  finish(): SseFinish;
} {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  let stopped = false;

  function takeDelimited(): unknown[] {
    if (stopped) {
      buffer = "";
      return [];
    }
    const events: unknown[] = [];
    const pieces = buffer.split(/\r?\n\r?\n/);
    buffer = pieces.pop() ?? "";
    for (const block of pieces) {
      const data = dataFromBlock(block);
      if (data === "") continue;
      if (data === "[DONE]") {
        stopped = true;
        buffer = "";
        break;
      }
      const inspected = inspectJsonFragment(data);
      switch (inspected.kind) {
        case "complete":
          events.push(inspected.value);
          break;
        case "incomplete":
        case "invalid":
          break;
        default:
          return assertNever(inspected);
      }
    }
    return events;
  }

  function remainderOf(rest: string): SseFinish["remainder"] {
    if (stopped) return "empty";
    const trimmed = rest.trim();
    if (trimmed === "") return "empty";
    const data = dataFromBlock(rest);
    if (data === "") return "incomplete";
    if (data === "[DONE]") return "empty";
    const inspected = inspectJsonFragment(data);
    switch (inspected.kind) {
      case "complete":
        return "empty";
      case "incomplete":
        return "incomplete";
      case "invalid":
        return "invalid";
      default:
        return assertNever(inspected);
    }
  }

  return {
    push(bytes: Uint8Array): SsePushResult {
      if (stopped) return { events: [], progressed: false };
      buffer += decoder.decode(bytes, { stream: true });
      const events = takeDelimited();
      return { events, progressed: events.length > 0 };
    },
    finish(): SseFinish {
      buffer += decoder.decode();
      const events = takeDelimited();
      if (stopped) return { events, remainder: "empty" };
      const data = dataFromBlock(buffer);
      if (data === "[DONE]") {
        stopped = true;
        buffer = "";
        return { events, remainder: "empty" };
      }
      const inspected = data === "" ? null : inspectJsonFragment(data);
      if (inspected?.kind === "complete") {
        events.push(inspected.value);
        buffer = "";
        return { events, remainder: "empty" };
      }
      const remainder = remainderOf(buffer);
      return { events, remainder };
    },
  };
}
