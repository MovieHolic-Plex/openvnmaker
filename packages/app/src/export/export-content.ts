/** The standalone player has no bundled sample manuscript. */
export * from "../../../content/src/schema.js";
export * from "../../../content/src/manifest.js";
export * from "../../../content/src/parse.js";
export * from "../../../content/src/conditions.js";
export * from "../../../content/src/characters.js";
import type { VnScript } from "../../../content/src/schema.js";

export let script: VnScript;
export function setExportedScript(value: VnScript) { script = value; }
export * from "../../../content/src/audio.js";
