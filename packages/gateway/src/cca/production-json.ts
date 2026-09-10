import type { JsonFragmentState } from "./production-types.js";

function isWs(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function skipWs(text: string, index: number): number {
  let i = index;
  while (i < text.length && isWs(text.charAt(i))) i += 1;
  return i;
}

type Scan = { readonly kind: "ok"; readonly index: number } | { readonly kind: "incomplete" } | { readonly kind: "invalid" };

function scanLiteral(text: string, index: number, literal: string): Scan {
  const slice = text.slice(index, index + literal.length);
  if (slice === literal) return { kind: "ok", index: index + literal.length };
  if (literal.startsWith(slice) && index + slice.length === text.length) return { kind: "incomplete" };
  return { kind: "invalid" };
}

function scanString(text: string, start: number): Scan {
  let i = start + 1;
  while (i < text.length) {
    const char = text.charAt(i);
    if (char === '"') return { kind: "ok", index: i + 1 };
    if (char === "\\") {
      i += 1;
      if (i >= text.length) return { kind: "incomplete" };
      const escaped = text.charAt(i);
      if (escaped === "u") {
        const hex = text.slice(i + 1, i + 5);
        if (hex.length < 4) return { kind: "incomplete" };
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { kind: "invalid" };
        i += 5;
        continue;
      }
      if ('"\\/bfnrt'.includes(escaped)) {
        i += 1;
        continue;
      }
      return { kind: "invalid" };
    }
    if (char.charCodeAt(0) < 0x20) return { kind: "invalid" };
    i += 1;
  }
  return { kind: "incomplete" };
}

function scanNumber(text: string, start: number): Scan {
  let i = start;
  if (text.charAt(i) === "-") {
    i += 1;
    if (i >= text.length) return { kind: "incomplete" };
  }
  const first = text.charAt(i);
  if (first < "0" || first > "9") return { kind: "invalid" };
  if (first === "0") i += 1;
  else {
    while (i < text.length && text.charAt(i) >= "0" && text.charAt(i) <= "9") i += 1;
  }
  if (text.charAt(i) === ".") {
    i += 1;
    if (i >= text.length) return { kind: "incomplete" };
    if (text.charAt(i) < "0" || text.charAt(i) > "9") return { kind: "invalid" };
    while (i < text.length && text.charAt(i) >= "0" && text.charAt(i) <= "9") i += 1;
  }
  const exp = text.charAt(i);
  if (exp === "e" || exp === "E") {
    i += 1;
    if (i >= text.length) return { kind: "incomplete" };
    const sign = text.charAt(i);
    if (sign === "+" || sign === "-") {
      i += 1;
      if (i >= text.length) return { kind: "incomplete" };
    }
    if (text.charAt(i) < "0" || text.charAt(i) > "9") return { kind: "invalid" };
    while (i < text.length && text.charAt(i) >= "0" && text.charAt(i) <= "9") i += 1;
  }
  return { kind: "ok", index: i };
}

function scanValue(text: string, start: number): Scan {
  const index = skipWs(text, start);
  if (index >= text.length) return { kind: "incomplete" };
  const char = text.charAt(index);
  if (char === '"') return scanString(text, index);
  if (char === "{") return scanObject(text, index);
  if (char === "[") return scanArray(text, index);
  if (char === "t") return scanLiteral(text, index, "true");
  if (char === "f") return scanLiteral(text, index, "false");
  if (char === "n") return scanLiteral(text, index, "null");
  if (char === "-" || (char >= "0" && char <= "9")) return scanNumber(text, index);
  return { kind: "invalid" };
}

function scanObject(text: string, start: number): Scan {
  let i = skipWs(text, start + 1);
  if (i >= text.length) return { kind: "incomplete" };
  if (text.charAt(i) === "}") return { kind: "ok", index: i + 1 };
  while (true) {
    if (text.charAt(i) !== '"') return i >= text.length ? { kind: "incomplete" } : { kind: "invalid" };
    const key = scanString(text, i);
    if (key.kind !== "ok") return key;
    i = skipWs(text, key.index);
    if (i >= text.length) return { kind: "incomplete" };
    if (text.charAt(i) !== ":") return { kind: "invalid" };
    const value = scanValue(text, i + 1);
    if (value.kind !== "ok") return value;
    i = skipWs(text, value.index);
    if (i >= text.length) return { kind: "incomplete" };
    const sep = text.charAt(i);
    if (sep === "}") return { kind: "ok", index: i + 1 };
    if (sep !== ",") return { kind: "invalid" };
    i = skipWs(text, i + 1);
    if (i >= text.length) return { kind: "incomplete" };
  }
}

function scanArray(text: string, start: number): Scan {
  let i = skipWs(text, start + 1);
  if (i >= text.length) return { kind: "incomplete" };
  if (text.charAt(i) === "]") return { kind: "ok", index: i + 1 };
  while (true) {
    const value = scanValue(text, i);
    if (value.kind !== "ok") return value;
    i = skipWs(text, value.index);
    if (i >= text.length) return { kind: "incomplete" };
    const sep = text.charAt(i);
    if (sep === "]") return { kind: "ok", index: i + 1 };
    if (sep !== ",") return { kind: "invalid" };
    i = skipWs(text, i + 1);
    if (i >= text.length) return { kind: "incomplete" };
  }
}

export function isJsonPrefix(text: string): boolean {
  const scanned = scanValue(text, 0);
  if (scanned.kind === "incomplete") return true;
  if (scanned.kind === "invalid") return false;
  return skipWs(text, scanned.index) === text.length;
}

export function inspectJsonFragment(text: string): JsonFragmentState {
  try {
    return { kind: "complete", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: isJsonPrefix(text) ? "incomplete" : "invalid" };
  }
}
