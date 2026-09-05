import { script } from "@vnmaker/content";

export const EDITION_KEY = "vnmaker.edition";
export const EDITION = "rain-blank-2026-09-05-r1";
// This one-time reset implements the user's explicit request to remove the old
// projects. Only VN manuscript/checkpoint/save keys are retired; preferences and
// gateway credentials are outside its scope. Later edits to the new work survive.
export function initializeEdition(storage: Storage = localStorage, session: Storage = sessionStorage) {
  if (script.title !== "비가 남긴 빈칸" || storage.getItem(EDITION_KEY) === EDITION) return;
  const retired = Object.keys(storage).filter(key => key.startsWith("vnmaker.studio.project") || key.startsWith("vnmaker.studio.production") || key.startsWith("vnmaker.studio.position") || key.startsWith("vnmaker.studio.art-recovery") || key === "vnmaker:save" || key === "vnmaker:save:preview");
  for (const key of retired) storage.removeItem(key);
  session.removeItem("vnmaker.previewScript");
  session.removeItem("vnmaker.previewPosition");
  storage.setItem("vnmaker.studio.project.v1", JSON.stringify(script));
  storage.setItem(EDITION_KEY, EDITION);
}
