import { sfxSrc } from "./paths.js";

const cache = new Map<string, HTMLAudioElement>();

/** 효과음 한 발. 자동재생이 막혀 있으면 조용히 무시한다. 파일을 열지 못한 경우만 onError 로 알린다. */
export function playSfx(id: string, volume: number, onError?: (id: string) => void): void {
  let base = cache.get(id);
  if (!base) {
    base = new Audio(sfxSrc(id));
    base.preload = "none";
    if(cache.size>=32)cache.delete(cache.keys().next().value!);
    cache.set(id, base);
  }
  const shot = base.cloneNode(true) as HTMLAudioElement;
  shot.volume = Math.min(1, Math.max(0, volume));
  if (onError) shot.addEventListener("error", () => onError(id), { once: true });
  void shot.play().catch(() => undefined);
}
