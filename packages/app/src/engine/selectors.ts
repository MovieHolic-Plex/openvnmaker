import type { Line, Scene, SpriteDirection, VnScript } from "@vnmaker/content";
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
export function backgroundAt(scene: Scene, lineIndex: number): string | undefined {
  let result = scene.backgroundUrl;
  for (const line of scene.lines.slice(0, Math.max(0, lineIndex + 1))) if (line.backgroundUrl !== undefined) result = line.backgroundUrl;
  return result;
}

/** Cue-bound artwork follows a dialogue line, so inserting lines keeps its cue attached. */
export function cgAt(scene: Scene, lineIndex: number): string | undefined {
  let result = scene.cgUrl;
  for (const line of scene.lines.slice(0, lineIndex + 1)) if (line.cgUrl !== undefined) result = line.cgUrl ?? undefined;
  return result;
}

/** 현재 줄까지 반영한 표정을 슬롯별로 계산한다. */
export function spritesAt(scene: Scene, lineIndex: number): SpriteDirection[] {
  const base = new Map<string, SpriteDirection>();
  for (const dir of scene.sprites ?? []) base.set(dir.slot, dir);
  for (const line of scene.lines.slice(0, lineIndex + 1)) {
    const speaking = line.speaker;
    if (line.expression && speaking && speaking !== "me") {
      for (const [slot, dir] of base) {
        if (dir.character === speaking) base.set(slot, { ...dir, expression: line.expression });
      }
    }
  }
  return [...base.values()].filter((d) => d.character !== null);
}

export function speakerName(script: VnScript, speaker: Line["speaker"]): string | null {
  if (speaker === null) return null;
  if (speaker === "me") return "정우진";
  return script.characters.find((c) => c.id === speaker)?.name ?? speaker;
}

export function speakerColor(script: VnScript, speaker: Line["speaker"]): string {
  if (speaker === "me") return "#b7c6d4";
  if (speaker === null) return "#d7d1c6";
  return script.characters.find((c) => c.id === speaker)?.color ?? "#d7d1c6";
}
