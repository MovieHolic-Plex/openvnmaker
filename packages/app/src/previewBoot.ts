import { parseScript, type VnScript } from "@vnmaker/content";
import { reduce } from "./engine/reducer.js";
import { initialState, type VnState } from "./engine/types.js";

export type PreviewBoot = {
  readonly script: VnScript;
  readonly state: VnState;
};

export function studioPreviewBoot(
  isStudioPreview: boolean,
  fallback: VnScript,
  storage?: Pick<Storage, "getItem">,
): PreviewBoot {
  const titled: PreviewBoot = { script: fallback, state: initialState(fallback) };
  if (!isStudioPreview) return titled;
  try {
    const store = storage ?? sessionStorage;
    const raw = store.getItem("vnmaker.previewScript");
    if (!raw) return titled;
    const parsed = parseScript(JSON.parse(raw));
    let state = reduce(parsed, initialState(parsed), { type: "start" });
    try {
      const position = JSON.parse(store.getItem("vnmaker.previewPosition") ?? "null") as {
        sceneId?: string;
        lineIndex?: number;
        flags?: VnState["flags"];
      } | null;
      const previewScene = parsed.scenes.find(row => row.id === position?.sceneId);
      if (previewScene && typeof position?.lineIndex === "number") {
        state = reduce(parsed, state, {
          type: "restore",
          sceneId: previewScene.id,
          lineIndex: Math.max(0, Math.min(position.lineIndex, previewScene.lines.length - 1)),
          affection: 0,
          ...(position.flags ? { flags: position.flags } : {}),
        });
      }
    } catch {
      // 깨진 위치 JSON 은 시작 장면만 유지한다.
    }
    return { script: parsed, state };
  } catch {
    return titled;
  }
}
