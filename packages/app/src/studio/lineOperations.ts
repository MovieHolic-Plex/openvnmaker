import type { Character, Line, Scene } from "@vnmaker/content";

/** 대사 순서 변경. 범위를 벗어난 목표는 양 끝으로 클램프하고, 같은 자리면 원본을 그대로 반환한다. */
export function moveLine(scene: Scene, from: number, to: number): Scene {
  if (from < 0 || from >= scene.lines.length) throw new Error("이동할 대사가 없습니다.");
  const target = Math.max(0, Math.min(scene.lines.length - 1, to));
  if (target === from) return scene;
  const lines = [...scene.lines]; const [line] = lines.splice(from, 1); lines.splice(target, 0, line!);
  return { ...scene, lines };
}

/** 복사한 줄은 식별자를 비워 두어 withNarrativeIds 가 새 ID를 준다. */
export function duplicateLine(scene: Scene, index: number): Scene {
  const source = scene.lines[index];
  if (!source) throw new Error("복제할 대사가 없습니다.");
  const { id: _id, ...copy } = structuredClone(source) as Line;
  return { ...scene, lines: [...scene.lines.slice(0, index + 1), copy, ...scene.lines.slice(index + 1)] };
}

export function removeLine(scene: Scene, index: number): Scene {
  if (scene.lines.length <= 1) throw new Error("씬에는 대사가 최소 한 줄 필요합니다.");
  if (!scene.lines[index]) throw new Error("삭제할 대사가 없습니다.");
  return { ...scene, lines: scene.lines.filter((_, i) => i !== index) };
}

/** afterIndex 뒤에 여러 줄을 한 번에 넣는다. -1 이면 맨 앞. */
export function insertLines(scene: Scene, afterIndex: number, lines: readonly Line[]): Scene {
  if (!lines.length) return scene;
  const at = Math.max(0, Math.min(scene.lines.length, afterIndex + 1));
  return { ...scene, lines: [...scene.lines.slice(0, at), ...lines, ...scene.lines.slice(at)] };
}

/**
 * 붙여넣은 플레인텍스트를 대사 줄로 나눈다.
 * `이름: 대사` / `이름： 대사` 접두는 등장인물 이름이나 ID(대소문자 무시)와 맞을 때만 화자로 옮기고,
 * 모르는 이름은 접두를 그대로 남긴 내레이션으로 둔다. 빈 줄은 버린다.
 */
export function splitPastedText(text: string, characters: readonly Character[]): Line[] {
  const byName = new Map<string, string>();
  for (const actor of characters) { byName.set(actor.name.trim().toLocaleLowerCase(), actor.id); byName.set(actor.id.toLocaleLowerCase(), actor.id); }
  const lines: Line[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const row = raw.trim();
    if (!row) continue;
    const match = /^([^:：]{1,40}?)\s*[:：]\s*(.+)$/s.exec(row);
    const speaker = match ? byName.get(match[1]!.trim().toLocaleLowerCase()) : undefined;
    lines.push(speaker !== undefined && match ? { speaker, text: match[2]!.trim() } : { speaker: null, text: row });
  }
  return lines;
}
