export * from "./schema.js";
export * from "./manifest.js";
export * from "./parse.js";
import rainBlank from "../data/rain-blank.json" with { type: "json" };
import type { VnScript } from "./schema.js";
export const script: VnScript = rainBlank as unknown as VnScript;
