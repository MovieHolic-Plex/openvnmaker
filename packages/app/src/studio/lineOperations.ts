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

const SPEAKER_PREFIX = /^([^:：]{1,40}?)\s*[:：]\s*(.+)$/s;

function speakerLookup(characters: readonly Character[]): ReadonlyMap<string, string> {
  const byName = new Map<string, string>();
  for (const actor of characters) { byName.set(actor.name.trim().toLocaleLowerCase(), actor.id); byName.set(actor.id.toLocaleLowerCase(), actor.id); }
  return byName;
}

/**
 * 붙여넣은 플레인텍스트를 대사 줄로 나눈다.
 * `이름: 대사` / `이름： 대사` 접두는 등장인물 이름이나 ID(대소문자 무시)와 맞을 때만 화자로 옮기고,
 * 모르는 이름은 접두를 그대로 남긴 내레이션으로 둔다. 빈 줄은 버린다.
 */
export function splitPastedText(text: string, characters: readonly Character[]): Line[] {
  const byName = speakerLookup(characters);
  const lines: Line[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const row = raw.trim();
    if (!row) continue;
    const match = SPEAKER_PREFIX.exec(row);
    const speaker = match ? byName.get(match[1]!.trim().toLocaleLowerCase()) : undefined;
    lines.push(speaker !== undefined && match ? { speaker, text: match[2]!.trim() } : { speaker: null, text: row });
  }
  return lines;
}

/**
 * `이름:` 접두가 있지만 등장인물과 맞지 않는 줄의 이름들 — 붙여넣기 미리보기에서
 * 오타·미등록 인물을 내레이션으로 조용히 삼키기 전에 보여 주기 위한 경고용.
 */
export function unrecognizedSpeakers(text: string, characters: readonly Character[]): string[] {
  const byName = speakerLookup(characters);
  const unknown = new Set<string>();
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const row = raw.trim();
    if (!row) continue;
    const match = SPEAKER_PREFIX.exec(row);
    if (!match) continue;
    const name = match[1]!.trim();
    if (!byName.has(name.toLocaleLowerCase())) unknown.add(name);
  }
  return [...unknown];
}

/**
 * 내레이션 줄에 남은 `이름: ` 접두를, 그 이름과 맞는 인물로 화자를 바꿀 때 본문에서 뗀다.
 * 다른 인물의 접두는 건드리지 않는다 — 이름이 맞을 때만 뗀다.
 */
export function stripSpeakerPrefix(text: string, character: Character): string {
  const match = SPEAKER_PREFIX.exec(text.trim());
  if (!match) return text;
  const name = match[1]!.trim().toLocaleLowerCase();
  if (name !== character.name.trim().toLocaleLowerCase() && name !== character.id.toLocaleLowerCase()) return text;
  return match[2]!.trim();
}
