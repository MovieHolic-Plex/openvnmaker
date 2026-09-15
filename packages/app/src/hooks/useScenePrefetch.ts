import { useEffect } from "react";
import type { Scene, StoryFlags, VnScript } from "@vnmaker/content";
import { assetUrl } from "../assetUrl.js";
import { upcomingImages } from "../engine/upcomingAssets.js";

const warmed = new Set<string>();
/** 브라우저 캐시에 이미지를 미리 올린다. 같은 주소는 한 번만 요청한다. */
export function prefetchImages(urls: readonly string[]): void {
  if (typeof Image === "undefined") return;
  for (const url of urls) {
    const resolved = assetUrl(url);
    if (warmed.has(resolved)) continue;
    warmed.add(resolved);
    const image = new Image();
    image.decoding = "async";
    image.onerror = () => { warmed.delete(resolved); };
    image.src = resolved;
  }
}

/** 씬에 들어갈 때마다 다음 씬과 남은 연출 컷의 이미지를 미리 받아 두어 전환 때 빈 화면이 나지 않게 한다. */
export function useScenePrefetch(script: VnScript, scene: Scene | null, lineIndex: number, flags: StoryFlags, active: boolean): void {
  useEffect(() => {
    if (!active || !scene) return;
    // 현재 화면을 먼저 그린 뒤 여유 시간에 요청한다.
    const handle = window.setTimeout(() => prefetchImages(upcomingImages(script, scene, lineIndex, flags)), 120);
    return () => window.clearTimeout(handle);
  }, [script, scene, lineIndex, flags, active]);
}
