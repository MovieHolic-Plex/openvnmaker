import {
  PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID, evaluateCapabilities, inspectStoredAuth,
} from "../cca/capabilities.js";
import type {
  AuthState, CapabilityProof, CapabilityReport, FeatureReadiness,
} from "../cca/capabilities.js";
import type { ModelEntry } from "../cca/client.js";
import type { Credentials } from "../auth/credentials.js";
import { assertNever } from "../cca/production-util.js";
import { capabilityBindingSchema, type CapabilityBinding, type ProviderDispatch, type ProviderDispatchRequest, type ProviderDispatchResult } from "../../../harness/src/index.js";

export function productionKindForUnit(kind: ProviderDispatchRequest["kind"]): "text" | "image" {
  return kind === "image" ? "image" : "text";
}

export function modelIdForProductionKind(kind: "text" | "image"): string {
  switch (kind) {
    case "text": return PRODUCTION_TEXT_MODEL_ID;
    case "image": return PRODUCTION_IMAGE_MODEL_ID;
    default: return assertNever(kind);
  }
}

export function resolveHarnessCapabilities(input: {
  readonly credentials: Credentials | null;
  readonly now: number;
  readonly proofs: readonly CapabilityProof[];
  readonly models: readonly ModelEntry[];
  readonly configDigest: string;
}): { readonly auth: AuthState; readonly report: CapabilityReport } {
  const auth = inspectStoredAuth(input.credentials, input.now);
  const accountScope = auth.kind === "present"
    ? auth.accountScope
    : auth.kind === "expired" && auth.accountScope !== undefined
      ? auth.accountScope
      : "unconfigured";
  const providerProjectId = auth.kind === "present" || auth.kind === "expired" ? auth.providerProjectId : "unconfigured";
  return {
    auth,
    report: evaluateCapabilities({
      auth,
      context: {
        accountScope,
        providerProjectId,
        configDigest: input.configDigest,
        textModelId: PRODUCTION_TEXT_MODEL_ID,
        imageModelId: PRODUCTION_IMAGE_MODEL_ID,
      },
      models: input.models,
      proofs: input.proofs,
      upstream: { generate: async () => { throw new Error("live-probe-forbidden"); } },
    }),
  };
}

export function runnerBinding(report: CapabilityReport): CapabilityBinding {
  if (report.text.binding.ready) return capabilityBindingSchema.parse(report.text.binding);
  if (report.image.binding.ready) return capabilityBindingSchema.parse(report.image.binding);
  return capabilityBindingSchema.parse(report.text.binding);
}

function featureBlock(feature: FeatureReadiness): ProviderDispatchResult | null {
  switch (feature.status) {
    case "ready": return null;
    case "unverified": return { kind: "capability" };
    case "blocked":
      switch (feature.block.kind) {
        case "auth": return { kind: "auth" };
        case "quota": return { kind: "quota" };
        case "capability": return { kind: "capability" };
        default: return assertNever(feature.block);
      }
    default: return assertNever(feature);
  }
}

export function blockedDispatchResult(
  auth: AuthState,
  report: CapabilityReport,
  unitKind: ProviderDispatchRequest["kind"],
): ProviderDispatchResult | null {
  switch (auth.kind) {
    case "missing":
    case "expired":
      return { kind: "auth" };
    case "present":
      break;
    default:
      return assertNever(auth);
  }
  const productionKind = productionKindForUnit(unitKind);
  const model = productionKind === "image" ? report.image : report.text;
  if (model.binding.ready) return null;
  return featureBlock(productionKind === "image" ? model.imageOutput : model.text) ?? { kind: "capability" };
}

export function createBlockedDispatch(
  resolve: (request: ProviderDispatchRequest) => ProviderDispatchResult | Promise<ProviderDispatchResult>,
): ProviderDispatch {
  return { dispatch: (request) => Promise.resolve(resolve(request)) };
}
