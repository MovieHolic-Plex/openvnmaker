import { script } from "@vnmaker/content";

export const EDITION_KEY = "vnmaker.edition";
export const EDITION = "rain-blank-2026-09-05-r1";
// The original sample cleanup was a one-off project operation, not a migration
// policy for users. A missing version marker must never authorize deleting work.
export function initializeEdition(storage: Storage = localStorage) {
  if (script.title !== "비가 남긴 빈칸") return;
  if (storage.getItem(EDITION_KEY) === EDITION) {
    // Upgrade only the untouched previous bundled edition. User-edited drafts
    // and all newly created save slots/versions remain in place.
    try {
      const previous=JSON.parse(storage.getItem("vnmaker.studio.project.v1")??"null");
      let hash=2166136261;for(const char of JSON.stringify(previous))hash=Math.imul(hash^char.charCodeAt(0),16777619);
      if((hash>>>0).toString(36)==="m1g575") storage.setItem("vnmaker.studio.project.v1",JSON.stringify(script));
    } catch { /* Keep damaged or edited data available for recovery. */ }
    return;
  }
  // Studio checks durable project recovery before deciding to show a fresh sample.
  // The standalone player must not populate an empty editor key ahead of that check.
  storage.setItem(EDITION_KEY, EDITION);
}
