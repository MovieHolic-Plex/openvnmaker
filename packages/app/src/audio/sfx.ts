import { sfxSrc } from "./paths.js";

const cache = new Map<string, HTMLAudioElement>();

/** 효과음 한 발. 자동재생이 막혀 있으면 조용히 무시한다. */
export function playSfx(id: string, volume: number): void {
  let base = cache.get(id);
  if (!base) {
    base = new Audio(sfxSrc(id));
    base.preload = "auto";
    cache.set(id, base);
  }
  const shot = base.cloneNode(true) as HTMLAudioElement;
  shot.volume = Math.min(1, Math.max(0, volume));
  void shot.play().catch(() => undefined);
}
