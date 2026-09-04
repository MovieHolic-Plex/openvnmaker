import { useState } from "react";
import type { SpriteDirection } from "@vnmaker/content";

interface StageProps {
  readonly background: string;
  readonly sprites: readonly SpriteDirection[];
  readonly speaking: string | null;
  readonly chapter: string | null;
  readonly sceneEpoch: number;
  readonly transition: string;
  readonly cg: string | null;
  readonly cgHidden: boolean;
}

/** 한 슬롯 안에서 src 가 바뀌면 구 이미지를 깔고 새 이미지를 페이드인한다. */
function XfadeImg({ src, testId }: { readonly src: string; readonly testId: string }) {
  const [stack, setStack] = useState<[string | null, string]>([null, src]);
  if (stack[1] !== src) setStack([stack[1], src]);
  const [prev, cur] = stack;
  return (
    <>
      {prev !== null && prev !== cur && (
        <img key={prev} className="sprite-image is-fading-out" src={prev} alt="" aria-hidden="true" />
      )}
      <img
        key={cur}
        className="sprite-image is-entering"
        data-testid={testId}
        src={cur}
        alt=""
        onAnimationEnd={() => setStack((s) => (s[1] === cur ? [null, cur] : s))}
      />
    </>
  );
}

const slotOrder = ["left", "center", "right"] as const;

export function Stage({ background, sprites, speaking, chapter, sceneEpoch, transition, cg, cgHidden }: StageProps) {
  return (
    <div className="stage-layers">
      <div key={`${background}-${sceneEpoch}`} className={`bg-layer transition-${transition}`}>
        <img className="bg-image" data-testid="bg-image" src={`/assets/bg/${background}.png`} alt="" />
        <div className="bg-wash" />
      </div>
      {cg !== null && !cgHidden && (
        <div className="cg-layer">
          <img className="cg-image" data-testid="cg-image" src={`/assets/cg/${cg}.png`} alt="" />
        </div>
      )}
      <div className="dialogue-scrim" aria-hidden="true" />
      {slotOrder.map((slot) => {
        const dir = sprites.find((s) => s.slot === slot);
        if (!dir || dir.character === null) return null;
        const expression = dir.expression ?? "neutral";
        // 주인공(me)도 일반 id 로 본다. 무대 위에 없는 id 이므로 전원이 dim 된다.
        const active = speaking !== null && speaking === dir.character;
        return (
          <div key={slot} className={`sprite sprite--${slot} ${active ? "is-active" : "is-dim"}`}>
            <div className="sprite-card" />
            <XfadeImg src={`/assets/sprite/${dir.character}-${expression}.png`} testId={`sprite-${slot}`} />
          </div>
        );
      })}
      {chapter !== null && (
        <div className="chapter-label" data-testid="chapter-label" key={chapter}>
          <span>{chapter}</span>
        </div>
      )}
    </div>
  );
}
