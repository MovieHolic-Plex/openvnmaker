import { assertNever, parseDecisionReceipt, parsePreviewSnapshot, parseReuseAnalysis } from "@vnmaker/harness";
import type { CreateRunCommand, DecisionReceipt, ErrorEnvelope, PreviewSnapshot, ReuseAnalysis, RunCommand } from "@vnmaker/harness";

const STUDIO = { "X-VNMaker-Studio": "1" } as const;

export class HarnessApiError extends Error {
  override readonly name = "HarnessApiError";
  constructor(readonly envelope: ErrorEnvelope, readonly status: number) {
    super(envelope.message);
  }
}

export type AuthorUnitView = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly reason?: string;
  readonly code?: string;
};

export type AuthorRunView = {
  readonly id: string;
  readonly version: number;
  readonly sourceHead: { readonly projectId: string; readonly lineageId: string; readonly revision: number; readonly scriptHash: string; readonly productionHash: string };
  readonly candidateRef: { readonly candidateId: string; readonly revision: number };
  readonly state: { readonly status: string; readonly reason?: string };
  readonly units: readonly AuthorUnitView[];
  readonly proposalIds: readonly string[];
  readonly tokenPolicy: string;
  readonly lastEventSeq: number;
  readonly createdAt?: string;
  readonly limits?: { readonly run: { readonly textAttempts: number; readonly imageAttempts: number; readonly countRequests: number } };
};

export type HarnessCapabilityView = {
  readonly productionReady: boolean;
  readonly liveVerification: string;
  readonly textModelId: string;
  readonly imageModelId: string;
  readonly tokenWindowMode: string;
  readonly inputTokenLimit: number | null;
  readonly textStatus: string;
  readonly imageOutputStatus: string;
};

export type HarnessStreamEvent = { readonly seq: number; readonly type: string; readonly payload: unknown };

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { error: text.slice(0, 240) }; }
}

function asEnvelope(body: Record<string, unknown>, status: number): ErrorEnvelope {
  void status;
  const code = typeof body["code"] === "string" ? body["code"] : "UPSTREAM";
  const message = typeof body["message"] === "string" ? body["message"] : code;
  const envelope = { code, message, retryable: body["retryable"] === true };
  if (!isEnvelope(envelope)) return { code: "UPSTREAM", message: "UPSTREAM", retryable: true };
  return envelope;
}
function isEnvelope(value: { code: string; message: string; retryable: boolean }): value is ErrorEnvelope {
  return value.code.length > 0 && value.message.length > 0;
}

async function harnessFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  headers.set("X-VNMaker-Studio", STUDIO["X-VNMaker-Studio"]);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const body = await readJson(res);
  if (!res.ok) throw new HarnessApiError(asEnvelope(body, res.status), res.status);
  return body;
}

function readAuthorRun(body: Record<string, unknown>): AuthorRunView {
  const nested = typeof body["run"] === "object" && body["run"] !== null ? body["run"] as Record<string, unknown> : body;
  const sourceHead = nested["sourceHead"];
  const candidateRef = nested["candidateRef"];
  const state = nested["state"];
  if (typeof nested["id"] !== "string" || typeof nested["version"] !== "number" || typeof nested["lastEventSeq"] !== "number") {
    throw new Error("INVALID_INPUT");
  }
  if (typeof sourceHead !== "object" || sourceHead === null || typeof candidateRef !== "object" || candidateRef === null || typeof state !== "object" || state === null) {
    throw new Error("INVALID_INPUT");
  }
  const head = sourceHead as Record<string, unknown>;
  const candidate = candidateRef as Record<string, unknown>;
  const runState = state as Record<string, unknown>;
  if (typeof head["projectId"] !== "string" || typeof head["lineageId"] !== "string" || typeof head["revision"] !== "number" || typeof head["scriptHash"] !== "string" || typeof head["productionHash"] !== "string") throw new Error("INVALID_INPUT");
  if (typeof candidate["candidateId"] !== "string" || typeof candidate["revision"] !== "number") throw new Error("INVALID_INPUT");
  if (typeof runState["status"] !== "string") throw new Error("INVALID_INPUT");
  const units = Array.isArray(nested["units"]) ? nested["units"].flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null) return [];
    const unit = row as Record<string, unknown>;
    if (typeof unit["id"] !== "string" || typeof unit["kind"] !== "string" || typeof unit["status"] !== "string") return [];
    return [{ id: unit["id"], kind: unit["kind"], status: unit["status"], ...(typeof unit["reason"] === "string" ? { reason: unit["reason"] } : {}), ...(typeof unit["code"] === "string" ? { code: unit["code"] } : {}) }];
  }) : [];
  const proposalIds = Array.isArray(nested["proposalIds"]) ? nested["proposalIds"].filter((id: unknown): id is string => typeof id === "string") : [];
  return {
    id: nested["id"], version: nested["version"], lastEventSeq: nested["lastEventSeq"],
    sourceHead: { projectId: head["projectId"], lineageId: head["lineageId"], revision: head["revision"], scriptHash: head["scriptHash"], productionHash: head["productionHash"] },
    candidateRef: { candidateId: candidate["candidateId"], revision: candidate["revision"] },
    state: { status: runState["status"], ...(typeof runState["reason"] === "string" ? { reason: runState["reason"] } : {}) },
    units, proposalIds, tokenPolicy: typeof nested["tokenPolicy"] === "string" ? nested["tokenPolicy"] : "exact-only",
    ...(typeof nested["createdAt"] === "string" ? { createdAt: nested["createdAt"] } : {}),
  };
}

export async function createHarnessRun(command: CreateRunCommand): Promise<AuthorRunView> {
  return readAuthorRun(await harnessFetch("/api/harness/runs", { method: "POST", body: JSON.stringify(command) }));
}

export async function getHarnessRun(runId: string): Promise<AuthorRunView> {
  return readAuthorRun(await harnessFetch(`/api/harness/runs/${runId}`));
}

export async function mutateHarnessRun(runId: string, action: Exclude<RunCommand["action"], "previews">, command: object): Promise<AuthorRunView> {
  return readAuthorRun(await harnessFetch(`/api/harness/runs/${runId}/${action}`, { method: "POST", body: JSON.stringify(command) }));
}

export async function ackHarnessDecision(runId: string, kind: "applied" | "rejected", receipt: DecisionReceipt): Promise<DecisionReceipt> {
  switch (kind) {
    case "applied": case "rejected": break;
    default: return assertNever(kind);
  }
  if (receipt.kind !== kind) throw new HarnessApiError({ code: "INVALID_INPUT", message: "INVALID_INPUT", retryable: false }, 400);
  return parseDecisionReceipt(await harnessFetch(`/api/harness/runs/${runId}/${kind}`, {
    method: "POST", body: JSON.stringify({ requestId: receipt.receiptId, decisionReceipt: receipt }),
  }));
}

export async function analyzeHarnessReuse(runId: string, command: object): Promise<ReuseAnalysis> {
  return parseReuseAnalysis(await harnessFetch(`/api/harness/runs/${runId}/reuse-analysis`, { method: "POST", body: JSON.stringify(command) }));
}

export async function* subscribeHarnessEvents(runId: string, after = -1, signal?: AbortSignal): AsyncGenerator<HarnessStreamEvent> {
  const seen = new Set<number>();
  const res = await fetch(`/api/harness/runs/${runId}/events?after=${after}`, {
    headers: STUDIO, ...(signal === undefined ? {} : { signal }),
  });
  if (!res.ok || res.body === null) {
    const body = await readJson(res);
    throw new HarnessApiError(asEnvelope(body, res.status), res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSse(part);
      if (event === null || seen.has(event.seq)) continue;
      seen.add(event.seq);
      yield event;
    }
  }
}

function parseSse(block: string): HarnessStreamEvent | null {
  let id = ""; let event = "message"; let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (id === "") return null;
  return { seq: Number(id), type: event, payload: data === "" ? null : JSON.parse(data) as unknown };
}

export async function listHarnessRuns(projectId: string): Promise<readonly AuthorRunView[]> {
  const body = await harnessFetch(`/api/harness/runs?projectId=${encodeURIComponent(projectId)}`);
  const rows = body["runs"];
  if (!Array.isArray(rows)) return [];
  return rows.map(row => readAuthorRun(typeof row === "object" && row !== null ? row as Record<string, unknown> : {}));
}

export async function createHarnessPreview(runId: string, command: object): Promise<PreviewSnapshot> {
  return parsePreviewSnapshot(await harnessFetch(`/api/harness/runs/${runId}/previews`, { method: "POST", body: JSON.stringify(command) }));
}

function featureStatus(model: unknown, key: string): string {
  if (typeof model !== "object" || model === null) return "unverified";
  const feature = (model as Record<string, unknown>)[key];
  if (typeof feature !== "object" || feature === null) return "unverified";
  const status = (feature as Record<string, unknown>)["status"];
  return typeof status === "string" ? status : "unverified";
}

export async function getHarnessCapabilities(): Promise<HarnessCapabilityView> {
  const body = await harnessFetch("/api/harness/capabilities");
  const context = typeof body["context"] === "object" && body["context"] !== null ? body["context"] as Record<string, unknown> : {};
  const text = body["text"];
  const image = body["image"];
  const binding = typeof text === "object" && text !== null ? (text as Record<string, unknown>)["binding"] : undefined;
  const bind = typeof binding === "object" && binding !== null ? binding as Record<string, unknown> : {};
  return {
    productionReady: body["productionReady"] === true,
    liveVerification: typeof body["liveVerification"] === "string" ? body["liveVerification"] : "not-performed",
    textModelId: typeof context["textModelId"] === "string" ? context["textModelId"] : "gemini-3.8-flash-high",
    imageModelId: typeof context["imageModelId"] === "string" ? context["imageModelId"] : "gemini-3.1-flash-image",
    tokenWindowMode: typeof bind["tokenWindowMode"] === "string" ? bind["tokenWindowMode"] : "unknown",
    inputTokenLimit: typeof bind["inputTokenLimit"] === "number" ? bind["inputTokenLimit"] : null,
    textStatus: featureStatus(text, "text"),
    imageOutputStatus: featureStatus(image, "imageOutput"),
  };
}
