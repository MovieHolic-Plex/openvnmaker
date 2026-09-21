import { useEffect, useRef, useState } from "react";
import type { InlinePart } from "../engine/inlineText.js";
import { InlineText } from "./InlineText.js";

interface Props {
  readonly speaker: string | null;
  readonly color: string;
  /** 타이프라이터가 지금까지 보여 주는 세그먼트(표기 적용·잘림 완료). */
  readonly parts: readonly InlinePart[];
  /** 세그먼트의 텍스트 총량 — 스크롤 추적의 변화 감지용. */
  readonly textLength: number;
  readonly typing: boolean;
  /** 타이핑이 끝난 전체 문장(표기 제거본). 스크린리더에는 글자 단위가 아니라 한 번에 읽힌다. */
  readonly fullText?: string | undefined;
  /** 긴 대사가 스크롤 영역이 되면 본문 클릭이 화면 클릭 층에 닿지 않는다 — 그 경우 여기로 진행한다. */
  readonly onAdvance?: (() => void) | undefined;
  /** 입력을 받는 줄이면 진행 화살표를 숨긴다 — 진행은 입력 패널이 한다. */
  readonly awaitingInput?: boolean;
}

export function DialogueBox({ speaker, color, parts, textLength, typing, fullText, onAdvance, awaitingInput = false }: Props) {
  const body = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  // 긴 대사는 상한 높이 안에서 스크롤하고, 타이핑 중에는 새로 쓰인 줄을 따라간다.
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const over = node.scrollHeight > node.clientHeight + 1;
    setOverflowing(over);
    if (over && typing) node.scrollTop = node.scrollHeight;
  }, [textLength, typing, parts]);
  useEffect(() => {
    const node = body.current;
    if (!node || typing) return;
    node.scrollTop = 0;
  }, [fullText, typing]);
  return (
    <div className={`dialogue-box ${speaker === null ? "is-narration" : ""}`} data-testid="dialogue-box">
      <div className="dialogue-paper" />
      {speaker !== null && (
        <div className="speaker-name" data-testid="speaker-name" style={{ color }}>
          {speaker}
        </div>
      )}
      <p ref={body} className={`dialogue-text ${speaker === null ? "is-narration" : ""} ${overflowing ? "is-overflowing" : ""}`} data-testid="dialogue-text" aria-hidden={fullText !== undefined ? true : undefined} onClick={event => { /* 본문은 선택 가능해야 한다 — 드래그로 글자를 고른 클릭은 진행으로 치지 않는다. */ if (window.getSelection()?.isCollapsed === false) return; event.stopPropagation(); onAdvance?.(); }} onWheel={overflowing ? event => event.stopPropagation() : undefined}>
        <InlineText parts={parts} />
      </p>
      {fullText !== undefined && <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="dialogue-live">{speaker !== null ? `${speaker}: ` : ""}{fullText}</p>}
      {!typing && !awaitingInput && <span className="next-mark" aria-hidden="true" />}
    </div>
  );
}
