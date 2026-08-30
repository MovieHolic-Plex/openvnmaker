export * from "./schema.js";
export * from "./manifest.js";
import scriptJson from "../data/script.json" with { type: "json" };
import type { VnScript } from "./schema.js";

export const script: VnScript = scriptJson as unknown as VnScript;
