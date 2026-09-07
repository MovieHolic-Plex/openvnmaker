import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ofl = /SIL Open Font License[\s,]+Version 1\.1/;

export function runtimeContentType(path: string) {
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "application/json";
}

interface ProvenanceFace { readonly file: string; readonly family: string; readonly weight: number; readonly source: string; readonly commit: string; readonly sha256: string }

/** Inventory the shipped Korean webfonts, not the editor's dependency list. */
export async function webFontNotices(appRoot: string) {
  const directory = resolve(appRoot, "src/styles/fonts");
  const provenance = JSON.parse(await readFile(resolve(directory, "provenance.json"), "utf8")) as { faces: ProvenanceFace[] };
  const ibm = await readFile(resolve(directory, "OFL-IBM-Plex-Sans-KR.txt"), "utf8");
  const noto = await readFile(resolve(directory, "OFL-Noto-Serif-KR.txt"), "utf8");
  if (!ofl.test(ibm) || !ofl.test(noto)) throw new Error("Web font license text is missing; review the fonts before distributing them.");
  const lines = ["Korean webfonts bundled with the player and studio.", ""];
  for (const face of provenance.faces) {
    const bytes = await readFile(resolve(directory, face.file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== face.sha256) throw new Error(`Font bytes changed: ${face.file}`);
    lines.push(face.file, `Family: ${face.family}`, `Weight: ${String(face.weight)}`, `Source: ${face.source}`, `Commit: ${face.commit}`, `SHA-256: ${sha256}`, "");
  }
  lines.push("IBM Plex Sans KR", ibm, "", "Noto Serif KR", noto);
  return new Map<string, Uint8Array>([["FONT-NOTICES.txt", Buffer.from(lines.join("\n"))]]);
}
