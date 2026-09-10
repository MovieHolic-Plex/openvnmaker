import { HARD_TRANSPORT_LIMITS, HarnessError } from "../../../harness/src/index.js";

export class TransportLimitError extends HarnessError {
  readonly transport = true as const;
  constructor() { super("LIMIT_EXCEEDED"); }
}

export async function readBoundedText(request: Request): Promise<string> {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > HARD_TRANSPORT_LIMITS.snapshotBodyBytes) throw new TransportLimitError();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new HarnessError("INVALID_INPUT");
  }
}

export function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HarnessError("INVALID_INPUT");
  }
}
