import { useEffect, useRef, useState } from "react";
import { bgmSrc } from "./paths.js";


interface Props {
  readonly track: string | null;
  readonly volume: number;
  /** 첫 사용자 제스처 이후에만 true. 브라우저 자동재생 정책 때문이다. */
  readonly unlocked: boolean;
  readonly fadeSeconds?: number | undefined;
}

type SlotName = "a" | "b";

/**
 * <audio> 두 개를 번갈아 쓰면서 작품에 지정된 시간으로 크로스페이드한다.
 * 지금 들리는 쪽이 data-testid="bgm-audio" 를 갖는다.
 */
export function BgmPlayer({ track, volume, unlocked, fadeSeconds=1.2 }: Props) {
  const fadeRef=useRef(fadeSeconds);fadeRef.current=fadeSeconds;
  const volumeRef=useRef(volume);
  volumeRef.current=Math.min(1,Math.max(0,volume));
  const aRef = useRef<HTMLAudioElement | null>(null);
  const bRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const gains=useRef({active:0,idle:0});
  const [slots, setSlots] = useState<{ a: string | null; b: string | null; active: SlotName }>({
    a: null,
    b: null,
    active: "a",
  });

  useEffect(() => {
    if (!unlocked) return;
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
    const hasTrack=!!(slots.active==="a"?slots.a:slots.b);
    active.volume = 0;
    if(hasTrack){active.currentTime=0;void active.play().catch(() => undefined);}else active.pause();
    const fadeMs=Math.max(0,fadeRef.current)*1000;
    const startedAt = performance.now();
    const idleFrom = gains.current.active;
    gains.current={active:0,idle:idleFrom};
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const step = (now: number) => {
      // rAF 타임스탬프는 performance.now() 보다 살짝 앞설 수 있다. 물리지 않으면 volume 이 음수가 되고
      // HTMLMediaElement 가 IndexSizeError 를 던진다.
      const t = fadeMs===0?1:clamp((now - startedAt) / fadeMs);
      gains.current={active:hasTrack?t:0,idle:idleFrom*(1-t)};
      active.volume = clamp(volumeRef.current * gains.current.active);
      if (idle) idle.volume = clamp(volumeRef.current * gains.current.idle);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      if (idle) idle.pause();
      rafRef.current = null;
    };
    if(fadeMs===0)step(startedAt);else rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [slots, unlocked]);

  useEffect(() => {
    const active = slots.active === "a" ? aRef.current : bRef.current;
    const idle = slots.active === "a" ? bRef.current : aRef.current;
    if(active)active.volume=volumeRef.current*gains.current.active;
    if(idle)idle.volume=volumeRef.current*gains.current.idle;
  }, [volume, slots.active]);

  const idOf = (slot: SlotName) => (slot === slots.active ? "bgm-audio" : "bgm-audio-idle");

  return (
    <>
      <audio ref={aRef} data-testid={idOf("a")} loop preload="auto" {...(slots.a ? { src: bgmSrc(slots.a) } : {})} />
      <audio ref={bRef} data-testid={idOf("b")} loop preload="auto" {...(slots.b ? { src: bgmSrc(slots.b) } : {})} />
    </>
  );
}
