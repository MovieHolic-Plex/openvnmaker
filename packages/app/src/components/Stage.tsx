import { characterImage, validBackgroundUrl, type Character, type SpriteDirection, type WeatherEffect } from "@vnmaker/content";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { assetUrl } from "../assetUrl.js";
import "./art-stage.css";
import { ArtImage } from "./ArtImage.js";
import { Weather } from "./Weather.js";

interface Props {
  readonly background: string;
  readonly backgroundUrl?: string | undefined;
  readonly cgUrl?: string | undefined;
  readonly hideSprites?: boolean | undefined;
  readonly framing?: "wide" | "close" | "cinematic" | undefined;
  readonly characters?: readonly Character[] | undefined;
  readonly sprites: readonly SpriteDirection[];
  readonly speaking: string | null;
  readonly chapter: string | null;
  readonly sceneEpoch: number;
  readonly transition: string;
  /** 현재 줄까지 반영된 입자 연출. null/undefined 면 표시하지 않는다. */
  readonly effect?: WeatherEffect | null | undefined;
  /** 현재 줄까지 반영된 장면 틴트(CSS hex). null/undefined 면 표시하지 않는다. */
  readonly tint?: string | null | undefined;
  /** 동작 줄이기 — 페이드 없이 즉시 바꾼다. */
  readonly reducedMotion?: boolean | undefined;
}

const slotOrder = ["left", "center", "right"] as const;

/** 틴트를 반투명 색으로 환산 — 3/6자리 hex는 기본 알파(0.34), 4/8자리는 작성자 알파를 존중한다. */
function tintCss(hex: string): string {
  const h = hex.slice(1);
  const short = h.length <= 4;
  const d = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
  const r = d(h.slice(0, short ? 1 : 2));
  const g = d(h.slice(short ? 1 : 2, short ? 2 : 4));
  const b = d(h.slice(short ? 2 : 4, short ? 3 : 6));
  const a = h.length === 4 ? d(h.slice(3)) / 255 : h.length === 8 ? d(h.slice(6, 8)) / 255 : 0.34;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/** 전환 효과별 페이드 길이(ms). global.css 의 keyframes 길이와 같아야 이전 배경을 제때 걷어낸다. */
const TRANSITION_MS: Record<string, number> = { none: 0, fade: 640, dissolve: 780, flash: 460, fadeToBlack: 820 };
/** 배경·대체 배경이 모두 없을 때 보여 주는 어두운 판. 네트워크 없이도 그려진다. */
export const PLACEHOLDER_BACKGROUND = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2230"/><stop offset="1" stop-color="#090b10"/></linearGradient></defs><rect width="16" height="9" fill="url(#g)"/></svg>');
/** 이만큼 지나도 새 배경이 안 오면 불러오는 중이라고 알린다. */
const SLOW_MS = 300;

interface Layer { readonly target: string; readonly src: string; readonly step: 0 | 1 | 2 }

/**
 * 배경을 두 겹으로 그린다. 새 배경이 로드될 때까지 이전 배경을 그대로 두고, 로드가 끝나면 전환 효과로 덮는다.
 * 이전 방식(씬마다 <img> 를 새로 마운트)은 느린 네트워크에서 배경이 도착할 때까지 어두운 빈 화면만 보였다.
 * 로드에 실패하면 원고의 기본 배경 → 어두운 판 순서로 물러난다.
 */
function StageBackground({ src, fallbackSrc, transition, reducedMotion }: { src: string; fallbackSrc: string; transition: string; reducedMotion: boolean }) {
  // 한 객체로 관리한다 — 로드 중인 배경을 갈아탈 때 current/incoming/ready 가 서로 어긋나면 이전 배경이 사라진다.
  const [layers, setLayers] = useState<{ current: Layer | null; incoming: Layer | null; ready: boolean }>({ current: null, incoming: { target: src, src, step: 0 }, ready: false });
  const [slow, setSlow] = useState(false);
  const { current, incoming, ready } = layers;
  useEffect(() => {
    setLayers(prev => {
      if (prev.incoming?.target === src) return prev;
      // 로드 중이던 배경이 취소되고 원래 배경으로 돌아왔다(되돌리기 등).
      if (prev.current?.target === src) return prev.incoming ? { current: prev.current, incoming: null, ready: false } : prev;
      // 페이드 중이던(이미 로드된) 배경은 새 배경 아래에 남긴다 — 빈 화면이 생기지 않는다.
      const kept = prev.incoming && prev.ready ? prev.incoming : prev.current;
      return { current: kept, incoming: { target: src, src, step: 0 }, ready: false };
    });
    setSlow(false);
  }, [src]);
  useEffect(() => {
    if (!incoming || ready) { setSlow(false); return; }
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [incoming, ready]);
  const duration = reducedMotion ? 0 : TRANSITION_MS[transition] ?? TRANSITION_MS["fade"]!;
  useEffect(() => {
    if (!incoming || !ready) return;
    const timer = window.setTimeout(() => setLayers(prev => prev.incoming === incoming && prev.ready ? { current: incoming, incoming: null, ready: false } : prev), duration);
    return () => window.clearTimeout(timer);
  }, [incoming, ready, duration]);
  const markReady = useCallback(() => setLayers(prev => prev.incoming && !prev.ready ? { ...prev, ready: true } : prev), []);
  const onError = useCallback(() => {
    setLayers(prev => {
      const layer = prev.incoming;
      if (!layer) return prev;
      const next: Layer = layer.step === 0 && layer.src !== fallbackSrc ? { ...layer, src: fallbackSrc, step: 1 } : { ...layer, src: PLACEHOLDER_BACKGROUND, step: 2 };
      return { ...prev, incoming: next, ready: false };
    });
  }, [fallbackSrc]);
  // 캐시된 이미지는 load 이벤트보다 먼저 완료돼 있을 수 있다.
  const attach = useCallback((node: HTMLImageElement | null) => { if (node && node.complete && node.naturalWidth > 0) markReady(); }, [markReady]);
  return (
    <>
      {current && <img key={current.target} className={`bg-image ${incoming ? "is-previous" : ""}`} data-testid={incoming ? "bg-image-previous" : "bg-image"} src={current.src} alt="" data-art-error={current.step === 2 ? "true" : undefined} data-art-fallback={current.step === 1 ? "true" : undefined} />}
      {incoming && <img key={incoming.target} ref={attach} className={`bg-image is-incoming transition-${reducedMotion ? "none" : transition} ${ready ? "is-ready" : ""}`} data-testid="bg-image" src={incoming.src} alt="" onLoad={markReady} onError={onError} data-art-error={incoming.step === 2 ? "true" : undefined} data-art-fallback={incoming.step === 1 ? "true" : undefined} />}
      {incoming && slow && !ready && <div className="bg-loading" data-testid="bg-loading" aria-live="polite">{current ? "다음 장면을 불러오는 중…" : "장면을 불러오는 중…"}</div>}
    </>
  );
}

/** 퇴장 애니메이션이 도는 시간(ms). sprite-exit 키프레임 길이와 같아야 한다. */
const EXIT_MS = 620;

interface DepartedSprite { readonly key: number; readonly dir: SpriteDirection; readonly at: number }

function spriteImageOf(dir: SpriteDirection, characters: readonly Character[] | undefined) {
  const actor = characters?.find(character => character.id === dir.character);
  const src = dir.poseUrl ?? characterImage(actor ?? { id: dir.character!, name: "", bio: "", color: "#ffffff" }, dir.expression ?? "neutral", dir.outfit);
  return { actor, src: src && validBackgroundUrl(src) ? src : null };
}

export function Stage({ background, backgroundUrl, cgUrl, hideSprites, framing = "wide", characters, sprites, speaking, chapter, sceneEpoch, transition, effect, tint, reducedMotion = false }: Props) {
  const eventArt = validBackgroundUrl(cgUrl) ? cgUrl : null;
  const fallback = assetUrl(`/assets/bg/${background}.png`);
  const target = assetUrl(eventArt ?? (validBackgroundUrl(backgroundUrl) ? backgroundUrl : `/assets/bg/${background}.png`));

  // 퇴장 연출 — 레이아웃 이펙트에서 이전 배치와 비교해 사라진 배우를 잠시 ghost 로 남긴다.
  // 페인트 전에 ghost 가 붙으므로 한 프레임의 팝도 없다.
  const seen = useRef(new Map<string, SpriteDirection>());
  const departedSerial = useRef(0);
  const [departed, setDeparted] = useState<readonly DepartedSprite[]>([]);
  useLayoutEffect(() => {
    const previous = seen.current;
    const next = new Map<string, SpriteDirection>();
    for (const dir of sprites) if (dir.character !== null) next.set(dir.slot, dir);
    const gone: DepartedSprite[] = [];
    for (const [slot, dir] of previous) {
      const current = next.get(slot);
      if (!current || current.character !== dir.character) gone.push({ key: ++departedSerial.current, dir, at: Date.now() });
    }
    seen.current = next;
    if (gone.length && !reducedMotion) setDeparted(list => [...list, ...gone]);
  }, [sprites, reducedMotion]);
  useEffect(() => {
    if (!departed.length) return;
    // ghost 마다 수명이 다르다 — 가장 오래된 것이 만료될 때 지금까지 만료된 것만 걷어낸다.
    const wait = departed[0]!.at + EXIT_MS - Date.now();
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setDeparted(list => list.filter(item => item.at + EXIT_MS > now));
    }, Math.max(0, wait));
    return () => window.clearTimeout(timer);
  }, [departed]);
  // 같은 배우가 ghost 수명 안에 돌아오면 ghost 는 바로 걷는다(겹침 방지).
  const activeKeys = new Set(sprites.filter(dir => dir.character !== null).map(dir => `${dir.slot} ${dir.character}`));
  const ghosts = departed.filter(item => !activeKeys.has(`${item.dir.slot} ${item.dir.character}`));

  return (
    <div className={`stage-layers framing-${eventArt ? "cinematic" : framing} ${eventArt ? "has-event-cg" : ""} ${eventArt && !reducedMotion ? "cg-drift" : ""}`}>
      <StageBackground src={target} fallbackSrc={fallback} transition={transition} reducedMotion={reducedMotion} />
      <div className="bg-wash" />
      <div className={`scene-content transition-${reducedMotion ? "none" : transition}`} key={sceneEpoch}>
        {!hideSprites && !eventArt && slotOrder.map((slot) => {
          const dir = sprites.find((s) => s.slot === slot);
          if (!dir || dir.character === null) return null;
          const { actor, src } = spriteImageOf(dir, characters);
          if (!src) return null;
          const active = speaking === dir.character;
          const dim = speaking !== null && !active;
          return (
            <div key={`${slot}:${dir.character}`} className={`sprite sprite--${slot} ${reducedMotion ? "" : "sprite-enter"} ${dim ? "is-dim" : "is-active"}`}>
              <ArtImage
                className="sprite-image"
                testId={`sprite-${slot}`}
                chromaKey={actor?.chromaKey}
                src={src}
                alt=""
              />
            </div>
          );
        })}
        {!hideSprites && !eventArt && ghosts.map(item => {
          const { actor, src } = spriteImageOf(item.dir, characters);
          if (!src) return null;
          return (
            <div key={`ghost-${item.key}`} className={`sprite sprite--${item.dir.slot} sprite-exit`} aria-hidden="true">
              <ArtImage className="sprite-image" chromaKey={actor?.chromaKey} src={src} alt="" />
            </div>
          );
        })}
        {tint ? <div className="scene-tint" style={{ backgroundColor: tintCss(tint) }} aria-hidden="true" /> : null}
        {effect && !eventArt ? <Weather effect={effect} /> : null}
        {(framing === "cinematic" || eventArt) && <div className="cinematic-bars" aria-hidden="true" />}
        {chapter !== null && (
          <div className="chapter-label" data-testid="chapter-label">
            <span>{chapter}</span>
          </div>
        )}
      </div>
    </div>
  );
}
