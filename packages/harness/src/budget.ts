import { assertNever } from "./primitives.js";
import { HARD_TRANSPORT_LIMITS, TOKEN_SAFETY_RESERVE } from "./budget-contracts.js";
import type { BudgetAdmission, BudgetRequest } from "./budget-contracts.js";

/** Pure admission. Inputs describe used + reserved attempts, never inferred usage. No effects are dispatched. */
export function admitBudget(request: BudgetRequest): BudgetAdmission {
  let countedInputTokens: BudgetAdmission["countedInputTokens"] = null;
  let counterError: string | null = null;
  switch (request.counter.kind) {
    case "exact":
      if (request.capability.counterSupport === "exact" && request.counter.requestPayloadHash === request.requestPayloadHash &&
        request.counter.capabilityBindingHash === request.capabilityBindingHash &&
        request.counter.includes.text && request.counter.includes.tools && request.counter.includes.history && request.counter.includes.opaque &&
        (request.images.length === 0 || request.counter.includes.images)) countedInputTokens = request.counter.inputTokens;
      break;
    case "unsupported": break;
    case "error": counterError = `COUNTER_${request.counter.code.toUpperCase()}`; break;
    default: assertNever(request.counter);
  }
  let tokenCheck: BudgetAdmission["tokenCheck"] = "unknown";
  const output = request.requestedOutputTokens;
  const capability = request.capability;
  if (capability.outputTokenLimit !== null && output > capability.outputTokenLimit) tokenCheck = "fail";
  else if (countedInputTokens !== null) {
    switch (capability.tokenWindowMode) {
      case "input-only":
        if (capability.inputTokenLimit !== null) tokenCheck = countedInputTokens <= capability.inputTokenLimit - TOKEN_SAFETY_RESERVE ? "pass" : "fail";
        break;
      case "combined":
        if (capability.combinedTokenLimit !== null) tokenCheck = countedInputTokens <= capability.combinedTokenLimit - output - TOKEN_SAFETY_RESERVE ? "pass" : "fail";
        break;
      case "unknown": break;
      default: assertNever(capability.tokenWindowMode);
    }
  }
  const limit = (key: keyof BudgetRequest["limits"]["request"]) => Math.min(request.limits.request[key], capability.requestLimits?.[key] ?? Infinity);
  let reason = counterError;
  if (!request.unitAuthorized) reason ??= "WRITE_SCOPE_DENIED";
  if (!capability.ready) reason ??= "CAPABILITY_REQUIRED";
  if (request.textContextBytes > limit("textContextBytes")) reason ??= "TEXT_BYTES_LIMIT";
  if (request.wireBodyBytes > Math.min(limit("wireBodyBytes"), HARD_TRANSPORT_LIMITS.wireBodyBytes)) reason ??= "WIRE_BYTES_LIMIT";
  if (output === 0 || output > limit("maxOutputTokens")) reason ??= "OUTPUT_TOKENS_LIMIT";
  if (request.images.length > Math.min(limit("imageInputs"), HARD_TRANSPORT_LIMITS.imageInputs)) reason ??= "IMAGE_INPUTS_LIMIT";
  // Subtraction avoids safe-integer overflow in cumulative counters and image totals.
  let remainingImageBytes = limit("allImageRawBytes");
  for (const image of request.images) {
    if (image.rawBytes > limit("singleImageRawBytes")) reason ??= "SINGLE_IMAGE_BYTES_LIMIT";
    remainingImageBytes -= image.rawBytes;
    if (remainingImageBytes < 0) reason ??= "ALL_IMAGE_BYTES_LIMIT";
    if (image.width > limit("maxImagePixels") / image.height) reason ??= "IMAGE_PIXELS_LIMIT";
    if (Math.max(image.width, image.height) > limit("referenceMaxEdge")) reason ??= "REFERENCE_EDGE_LIMIT";
  }
  for (const scope of ["run", "chapter"] as const) {
    for (const key of ["textAttempts", "imageAttempts", "countRequests"] as const) {
      if (request.reserve[key] > request.limits[scope][key] - request.used[scope][key]) reason ??= `${scope.toUpperCase()}_${key.toUpperCase()}_LIMIT`;
    }
  }
  if (request.autoRepairRound > request.limits.maxAutoRepairRounds) reason ??= "REPAIR_ROUNDS_LIMIT";
  switch (tokenCheck) {
    case "fail": reason ??= "CONTEXT_LIMIT"; break;
    case "pass": break;
    case "unknown":
      switch (request.policy) {
        case "exact-only": reason ??= "CAPABILITY_REQUIRED"; break;
        case "bounded-payload": if (!request.boundedPayloadApproved) reason ??= "BOUNDED_PAYLOAD_APPROVAL_REQUIRED"; break;
        default: assertNever(request.policy);
      }
      break;
    default: assertNever(tokenCheck);
  }
  const allowed = reason === null;
  return {
    requestPayloadHash: request.requestPayloadHash, capabilityBindingHash: request.capabilityBindingHash,
    budgetGroupId: request.budgetGroupId, limitVersion: request.limitVersion,
    textContextBytes: request.textContextBytes, wireBodyBytes: request.wireBodyBytes, images: request.images,
    countedInputTokens, tokenWindowMode: capability.tokenWindowMode, requestedOutputTokens: output,
    tokenCheck, policy: request.policy, allowed, reason,
    authorization: allowed ? tokenCheck === "pass" ? "exact-approved" : "bounded-payload-approved" : null,
  };
}
