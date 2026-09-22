import { useEffect, useRef, useState } from "react";
import { bgmSrc } from "./paths.js";


interface Props {
  readonly track: string | null;
  readonly volume: number;
  /** 첫 사용자 제스처 이후에만 true. 브라우저 자동재생 정책 때문이다. */
  readonly unlocked: boolean;
  readonly fadeSeconds?: number | undefined;
  /** 음원 파일을 열지 못했을 때. 조용히 무음이 되지 않도록 화면에 알린다. */
  readonly onError?: ((track: string) => void) | undefined;
}

type SlotName = "a" | "b";

/**
 * <audio> 두 개를 번갈아 쓰면서 작품에 지정된 시간으로 크로스페이드한다.
 * 지금 들리는 쪽이 data-testid="bgm-audio" 를 갖는다.
 */
export function BgmPlayer({ track, volume, unlocked, fadeSeconds=1.2, onError }: Props) {
  const fadeRef=useRef(fadeSeconds);fadeRef.current=fadeSeconds;
  const errorRef=useRef(onError);errorRef.current=onError;
  const volumeRef=useRef(volume);
  volumeRef.current=Math.min(1,Math.max(0,volume));
  const aRef = useRef<HTMLAudioElement | null>(null);
  const bRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const gains=useRef({active:0,idle:0});
  // play() 가 거절(자동재생 정책·디코딩 지연)된 상태인지 — 다음 제스처에서 재시도하기 위한 표지.
  const failedRef = useRef(false);
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
    if(hasTrack){active.currentTime=0;void active.play().catch(() => { failedRef.current = true; });}else active.pause();
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

  // play() 한 번이 거절돼도 다음 제스처·탭 복귀·canplay 에서 재시도한다 — 한 번 실패가
  // 그 세션의 무음을 고정하지 않게 한다(첫 클릭 타이밍에 정책이 아직 안 풀리는 경우가 있다).
  useEffect(() => {
    if (!unlocked) return;
    const retry = () => {
      if (!failedRef.current) return;
      const active = slots.active === "a" ? aRef.current : bRef.current;
      const hasTrack = !!(slots.active === "a" ? slots.a : slots.b);
      if (!active || !hasTrack || !active.paused) return;
      failedRef.current = false;
      void active.play().catch(() => { failedRef.current = true; });
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [unlocked, slots]);

  useEffect(() => {
    const active = slots.active === "a" ? aRef.current : bRef.current;
    const idle = slots.active === "a" ? bRef.current : aRef.current;
    if(active)active.volume=volumeRef.current*gains.current.active;
    if(idle)idle.volume=volumeRef.current*gains.current.idle;
  }, [volume, slots.active]);

  const idOf = (slot: SlotName) => (slot === slots.active ? "bgm-audio" : "bgm-audio-idle");

  return (
    <>
      <audio ref={aRef} data-testid={idOf("a")} loop preload="auto" onError={()=>{if(slots.a)errorRef.current?.(slots.a);}} {...(slots.a ? { src: bgmSrc(slots.a) } : {})} />
      <audio ref={bRef} data-testid={idOf("b")} loop preload="auto" onError={()=>{if(slots.b)errorRef.current?.(slots.b);}} {...(slots.b ? { src: bgmSrc(slots.b) } : {})} />
    </>
  );
}
