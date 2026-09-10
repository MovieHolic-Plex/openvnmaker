import {
  AGENT_MAX_OUTPUT_TOKENS, CCA_HOSTS, CLIENT_ID, GENERATE_MAX_OUTPUT_TOKENS, GENERATE_PROMPT_MAX,
  GENERATE_TIMEOUT_MS, IMAGE_TIMEOUT_MS, LOAD_CODE_ASSIST_METADATA, PROVIDER, SCOPES,
  TEXT_THINKING_CONFIG, TOKEN_URL, antigravityUserAgent,
} from "../config.js";
import { mapModels } from "./client.js";
import type { ModelEntry } from "./client.js";
import { PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID, sha256Canonical } from "./capabilities.js";

export function productionConfigDigest(): string {
  return sha256Canonical({
    provider: PROVIDER, hosts: CCA_HOSTS, clientId: CLIENT_ID, tokenUrl: TOKEN_URL, scopes: SCOPES,
    metadata: LOAD_CODE_ASSIST_METADATA, userAgent: antigravityUserAgent(),
    textModelId: PRODUCTION_TEXT_MODEL_ID, imageModelId: PRODUCTION_IMAGE_MODEL_ID, thinking: TEXT_THINKING_CONFIG,
    textTimeout: GENERATE_TIMEOUT_MS, imageTimeout: IMAGE_TIMEOUT_MS, capabilityProtocol: 1,
    textOutput: GENERATE_MAX_OUTPUT_TOKENS, agentOutput: AGENT_MAX_OUTPUT_TOKENS, promptMax: GENERATE_PROMPT_MAX,
  });
}

export function productionCatalogue(): readonly ModelEntry[] {
  return mapModels({
    [PRODUCTION_TEXT_MODEL_ID]: { supportsImages: true },
    [PRODUCTION_IMAGE_MODEL_ID]: { supportsImages: true },
  });
}
