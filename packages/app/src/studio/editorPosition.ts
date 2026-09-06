import type { StoryFlags, VnScript } from "@vnmaker/content";
import {applyChoiceFlags,choiceEffectError} from "@vnmaker/content";

export type PreviewChoices = Readonly<Record<string, number>>;
export interface EditorPosition {
  sceneId?: string;
  lineIndex?: number;
  view?: string;
  focusMode?: boolean;
  choices?: PreviewChoices;
}

export function parseEditorPosition(raw: string | null): EditorPosition {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const row = value as Record<string, unknown>;
    return {
      ...(typeof row.sceneId === "string" ? { sceneId: row.sceneId } : {}),
      ...(typeof row.lineIndex === "number" && Number.isInteger(row.lineIndex) && row.lineIndex >= 0 ? { lineIndex: row.lineIndex } : {}),
      ...(typeof row.view === "string" ? { view: row.view } : {}),
      focusMode: row.focusMode === true,
      ...(row.choices && typeof row.choices === "object" && !Array.isArray(row.choices) ? { choices: Object.fromEntries(Object.entries(row.choices).filter(([key, value]) => !["__proto__", "prototype", "constructor"].includes(key) && typeof value === "number" && Number.isInteger(value) && value >= 0)) as Record<string, number> } : {}),
    };
  } catch { return {}; }
}

/** Rebuild from defaults so clearing or replacing a choice cannot retain stale flags. */
export function previewFlagsFor(script: VnScript, choices: PreviewChoices): StoryFlags {
  return script.scenes.reduce<StoryFlags>((flags, scene) => {
    const index = choices[scene.id];
    const choice=index===undefined?undefined:scene.choices?.[index];
    return !choice||choiceEffectError(choice,flags)?flags:applyChoiceFlags(flags,choice);
  }, { ...script.flags });
}
