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

/** 현재 줄까지 반영한 표정을 슬롯별로 계산한다. */
export function spritesAt(scene: Scene, lineIndex: number): SpriteDirection[] {
  const base = new Map<string, SpriteDirection>();
  for (const dir of scene.sprites ?? []) base.set(dir.slot, dir);
  const speaking = scene.lines[lineIndex]?.speaker ?? null;
  const override = scene.lines[lineIndex]?.expression;
  if (override && speaking) {
    for (const [slot, dir] of base) {
      if (dir.character === speaking) base.set(slot, { ...dir, expression: override });
    }
  }
  return [...base.values()].filter((d) => d.character !== null);
}

export function speakerName(script: VnScript, speaker: Line["speaker"]): string | null {
  if (speaker === null) return null;
  return script.characters.find((c) => c.id === speaker)?.name ?? speaker;
}

export function speakerColor(script: VnScript, speaker: Line["speaker"]): string {
  if (speaker === null) return "#5a544c";
  return script.characters.find((c) => c.id === speaker)?.color ?? "#5a544c";
}
