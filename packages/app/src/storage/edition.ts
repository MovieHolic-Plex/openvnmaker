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
      // FNV-1a 64 — scriptFingerprint(production.ts)와 같은 판정. 32비트 해시는
      // 구성 가능한 충돌로 수정한 원고를 샘플로 덮어쓸 수 있어 올렸다.
      let hash=0xcbf29ce484222325n;for(const char of JSON.stringify(previous))hash=BigInt.asUintN(64,(hash^BigInt(char.charCodeAt(0)))*0x100000001b3n);
      if(hash.toString(36)==="2coug0m8bikc1") storage.setItem("vnmaker.studio.project.v1",JSON.stringify(script));
    } catch { /* Keep damaged or edited data available for recovery. */ }
    return;
  }
  // Studio checks durable project recovery before deciding to show a fresh sample.
  // The standalone player must not populate an empty editor key ahead of that check.
  // 저장 공간이 꽉 차 있으면 표식을 못 쓸 수 있다 — 표식은 편의일 뿐이므로 부팅을 막아선 안 된다.
  try { storage.setItem(EDITION_KEY, EDITION); } catch { /* 다음 실행에서 다시 시도한다. */ }
}
