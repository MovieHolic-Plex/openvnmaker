import type { ProductionLine, ProductionScene } from "./production-types.js";

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s/gu, "");
}

export function isBodyPadding(before: string, after: string): boolean {
  const left = normalize(before);
  const right = normalize(after);
  if (left.length === 0 || right === left) return false;
  if (right === left.repeat(2)) return true;
  if (right.startsWith(left) && right.slice(left.length) === left) return true;
  return right.includes(left) && right.length >= left.length * 2;
}

export function applySelectedLines(
  scene: ProductionScene,
  selectedIds: readonly string[],
  lines: readonly ProductionLine[],
): ProductionScene {
  const selected = new Set(selectedIds);
  if (lines.some(line => !selected.has(line.id))) {
    throw new Error("선택한 대사만 보강할 수 있습니다.");
  }
  const replacements = new Map(lines.map(line => [line.id, line]));
  const nextLines = scene.lines.map(line => {
    const replacement = replacements.get(line.id);
    if (replacement === undefined) return line;
    if (isBodyPadding(line.text, replacement.text)) {
      throw new Error("본문을 늘려 분량을 채우지 말고 사건·동기·연출을 보강하세요.");
    }
    return replacement;
  });
  if (nextLines.length !== scene.lines.length) throw new Error("본문 padding 으로 줄을 추가할 수 없습니다.");
  return { ...scene, lines: nextLines };
}
