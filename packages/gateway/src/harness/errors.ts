import { assertNever, HarnessError } from "../../../harness/src/index.js";
import type { ErrorEnvelope, HarnessErrorCode } from "../../../harness/src/index.js";

export function envelope(code: HarnessErrorCode, extra: Partial<ErrorEnvelope> = {}): ErrorEnvelope {
  return { code, message: code, retryable: retryable(code), ...extra };
}

export function retryable(code: HarnessErrorCode): boolean {
  switch (code) {
    case "AUTH_REQUIRED": case "QUOTA": case "UPSTREAM": case "RUNNER_UNAVAILABLE": case "CONTEXT_LIMIT":
      return true;
    case "INVALID_OPERATION": case "INVALID_INPUT": case "UNKNOWN_TOOL": case "ID_PAYLOAD_CONFLICT":
    case "STALE_GAP": case "STALE_TARGET": case "STALE_HEAD": case "STALE_REVIEW": case "REFERENCED_ENTITY":
    case "WRITE_SCOPE_DENIED": case "REVIEW_REQUIRED": case "REPROPOSE_REQUIRED": case "UNKNOWN_EFFECT":
    case "INVALID_STATE": case "DECISION_CONFLICT": case "PREVIEW_NOT_RELEASE": case "CAPABILITY_REQUIRED":
    case "ORIGIN_DENIED": case "LIMIT_EXCEEDED": case "INVALID_CANONICAL_VALUE":
      return false;
    default: return assertNever(code);
  }
}

export function statusFor(code: HarnessErrorCode, kind: "body" | "domain" = "domain"): number {
  switch (code) {
    case "INVALID_OPERATION": case "INVALID_INPUT": case "UNKNOWN_TOOL": case "STALE_GAP": case "STALE_TARGET":
    case "REFERENCED_ENTITY": case "WRITE_SCOPE_DENIED": case "INVALID_CANONICAL_VALUE":
      return 400;
    case "AUTH_REQUIRED": return 401;
    case "CAPABILITY_REQUIRED": case "ORIGIN_DENIED": return 403;
    case "ID_PAYLOAD_CONFLICT": case "STALE_HEAD": case "STALE_REVIEW": case "REVIEW_REQUIRED":
    case "REPROPOSE_REQUIRED": case "UNKNOWN_EFFECT": case "INVALID_STATE": case "DECISION_CONFLICT":
    case "PREVIEW_NOT_RELEASE":
      return 409;
    case "LIMIT_EXCEEDED": return kind === "body" ? 413 : 400;
    case "QUOTA": return 429;
    case "UPSTREAM": case "CONTEXT_LIMIT": return 502;
    case "RUNNER_UNAVAILABLE": return 503;
    default: return assertNever(code);
  }
}

export function jsonError(code: HarnessErrorCode, kind: "body" | "domain" = "domain", extra: Partial<ErrorEnvelope> = {}): Response {
  return Response.json(envelope(code, extra), { status: statusFor(code, kind) });
}

export function fromUnknown(error: unknown): Response {
  if (error instanceof HarnessError) return jsonError(error.code);
  return jsonError("RUNNER_UNAVAILABLE");
}
