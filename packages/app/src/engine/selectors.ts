import { lineAllowed, type Line, type Scene, type SpriteDirection, type StoryFlags, type VnScript } from "@vnmaker/content";
import { findScene, type VnState } from "./types.js";

export function currentScene(script: VnScript, state: VnState): Scene | null {
  return findScene(script, state.sceneId);
}

export function currentLine(script: VnScript, state: VnState): Line | null {
  const scene = currentScene(script, state);
  if (!scene) return null;
  return scene.lines[state.lineIndex] ?? null;
}

/** Background cues persist within this scene independently of temporary event CGs. */
export function backgroundAt(scene: Scene, lineIndex: number, flags: StoryFlags = {}): string | undefined {
  let result = scene.backgroundUrl;
  for (const line of scene.lines.slice(0, Math.max(0, lineIndex + 1))) if (lineAllowed(line, flags) && line.backgroundUrl !== undefined) result = line.backgroundUrl;
  return result;
}

/** Cue-bound artwork follows a dialogue line, so inserting lines keeps its cue attached. */
export function cgAt(scene: Scene, lineIndex: number, flags: StoryFlags = {}): string | undefined {
  let result = scene.cgUrl;
  for (const line of scene.lines.slice(0, lineIndex + 1)) if (lineAllowed(line, flags) && line.cgUrl !== undefined) result = line.cgUrl ?? undefined;
  return result;
}

/** 현재 줄까지 반영한 표정을 슬롯별로 계산한다. */
export function spritesAt(scene: Scene, lineIndex: number, flags: StoryFlags = {}): SpriteDirection[] {
  const base = new Map<string, SpriteDirection>();
  for (const dir of scene.sprites ?? []) base.set(dir.slot, dir);
  for (const line of scene.lines.slice(0, lineIndex + 1)) {
    if (!lineAllowed(line, flags)) continue;
    for (const direction of line.sprites ?? []) {
      const previous = base.get(direction.slot);
      base.set(direction.slot, previous?.character === direction.character ? { ...previous, ...direction } : { ...direction });
    }
    const speaking = line.speaker;
    if (line.expression && speaking) {
      for (const [slot, dir] of base) {
        if (dir.character === speaking) base.set(slot, { ...dir, expression: line.expression });
      }
    }
  }
  return [...base.values()].filter((d) => d.character !== null);
}

export function framingAt(scene: Scene, lineIndex: number, flags: StoryFlags = {}) {
  let result = scene.framing ?? "wide";
  for (const line of scene.lines.slice(0,lineIndex+1)) if (lineAllowed(line,flags) && line.framing) result = line.framing;
  return result;
}

export function bgmAt(scene: Scene, lineIndex: number, flags: StoryFlags = {}): string | null {
  let result = scene.bgm ?? null;
  for (const line of scene.lines.slice(0,lineIndex+1)) if (lineAllowed(line,flags) && line.bgm !== undefined) result = line.bgm;
  return result;
}

export function speakerName(script: VnScript, speaker: Line["speaker"]): string | null {
  if (speaker === null) return null;
  return script.characters.find((c) => c.id === speaker)?.name ?? (speaker === "me" ? "정우진" : speaker);
}

export function speakerColor(script: VnScript, speaker: Line["speaker"]): string {
  if (speaker === null) return "#d7d1c6";
  return script.characters.find((c) => c.id === speaker)?.color ?? (speaker === "me" ? "#b7c6d4" : "#d7d1c6");
}
