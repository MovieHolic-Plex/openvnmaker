import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Read Unicode name records from the SDK's sfnt font without executing font code. */
export function fontLegalNames(bytes: Buffer) {
  const check = (offset: number, size: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length) throw new Error("Invalid font table bounds");
  };
  check(0, 12);
  const count = bytes.readUInt16BE(4); check(12, count * 16);
  let start = -1, length = 0;
  for (let index = 0; index < count; index++) {
    const entry = 12 + index * 16;
    if (bytes.toString("ascii", entry, entry + 4) === "name") { start = bytes.readUInt32BE(entry + 8); length = bytes.readUInt32BE(entry + 12); break; }
  }
  if (start < 0) throw new Error("Font has no name table");
  check(start, length); if (length < 6) throw new Error("Invalid font name table");
  const records = bytes.readUInt16BE(start + 2), strings = bytes.readUInt16BE(start + 4);
  if (6 + records * 12 > length || strings < 6 + records * 12 || strings > length) throw new Error("Invalid font name records");
  const values = new Map<number, Set<string>>();
  for (let index = 0; index < records; index++) {
    const entry = start + 6 + index * 12, platform = bytes.readUInt16BE(entry), encoding = bytes.readUInt16BE(entry + 2), id = bytes.readUInt16BE(entry + 6);
    if (![0, 13, 14].includes(id) || !(platform === 0 || platform === 3 && [1, 10].includes(encoding))) continue;
    const size = bytes.readUInt16BE(entry + 8), offset = strings + bytes.readUInt16BE(entry + 10);
    if (size % 2 || offset + size > length) throw new Error("Invalid font name string");
    const text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(start + offset, start + offset + size));
    const set = values.get(id) ?? new Set<string>(); set.add(text); values.set(id, set);
  }
  return { copyright: [...(values.get(0) ?? [])], license: [...(values.get(13) ?? [])], url: [...(values.get(14) ?? [])] };
}

export async function writeNativeFontNotices(sdk: string, destination: string) {
  const bytes = await readFile(resolve(sdk, "sdk-fonts/SourceHanSansLite.ttf"));
  const metadata = fontLegalNames(bytes);
  if (!metadata.copyright.length || !metadata.license.some(text => text.includes("SIL Open Font License, Version 1.1"))) throw new Error("SDK font license changed or is missing; review the font before distributing it.");
  // Retain the generic license verbatim; the Quicksand-specific preamble belongs to a different font.
  const supplied = await readFile(resolve(sdk, "renpy/common/_theme_awt/OFL.txt"), "utf8");
  const marker = "SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007";
  const index = supplied.indexOf(marker);
  if (index < 0 || !supplied.includes("TERMINATION") || !supplied.includes("DISCLAIMER")) throw new Error("SDK OFL license text is missing; review SDK notices.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(resolve(destination, "FONT-NOTICES.txt"), `SourceHanSansLite.ttf\nSHA-256: ${sha256}\n\n${metadata.copyright.join("\n")}\n\n${metadata.license.join("\n")}\n${metadata.url.join("\n")}\n\n${supplied.slice(index)}`);
  return { file: "SourceHanSansLite.ttf", sha256, ...metadata };
}
