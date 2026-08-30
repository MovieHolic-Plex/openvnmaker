import { useEffect, useRef, useState } from "react";
import { bgmSrc } from "./paths.js";

const FADE_MS = 1200;

interface Props {
  readonly track: string | null;
  readonly volume: number;
  /** 첫 사용자 제스처 이후에만 true. 브라우저 자동재생 정책 때문이다. */
  readonly unlocked: boolean;
}

type SlotName = "a" | "b";

/**
 * <audio> 두 개를 번갈아 쓰면서 1.2초 볼륨 램프로 크로스페이드한다.
 * 지금 들리는 쪽이 data-testid="bgm-audio" 를 갖는다.
 */
export function BgmPlayer({ track, volume, unlocked }: Props) {
  const aRef = useRef<HTMLAudioElement | null>(null);
  const bRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [slots, setSlots] = useState<{ a: string | null; b: string | null; active: SlotName }>({
    a: null,
    b: null,
    active: "a",
  });

  useEffect(() => {
    if (!unlocked || track === null) return;
    const playing = slots.active === "a" ? slots.a : slots.b;
    if (playing === track) return;
    setSlots((prev) => {
      const next: SlotName = prev.active === "a" ? "b" : "a";
      return { ...prev, [next]: track, active: next } as typeof prev;
    });
  }, [track, unlocked, slots]);

  useEffect(() => {
    if (!unlocked) return;
    const active = slots.active === "a" ? aRef.current : bRef.current;
    const idle = slots.active === "a" ? bRef.current : aRef.current;
    if (!active) return;
    active.volume = 0;
    void active.play().catch(() => undefined);
    const startedAt = performance.now();
    const idleFrom = idle?.volume ?? 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / FADE_MS);
      active.volume = Math.min(1, volume * t);
      if (idle) idle.volume = Math.max(0, idleFrom * (1 - t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      if (idle) idle.pause();
      rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [slots, unlocked, volume]);

  useEffect(() => {
    const active = slots.active === "a" ? aRef.current : bRef.current;
    if (active && rafRef.current === null) active.volume = volume;
  }, [volume, slots.active]);

  const idOf = (slot: SlotName) => (slot === slots.active ? "bgm-audio" : "bgm-audio-idle");

  return (
    <>
      <audio ref={aRef} data-testid={idOf("a")} loop preload="auto" {...(slots.a ? { src: bgmSrc(slots.a) } : {})} />
      <audio ref={bRef} data-testid={idOf("b")} loop preload="auto" {...(slots.b ? { src: bgmSrc(slots.b) } : {})} />
    </>
  );
}
