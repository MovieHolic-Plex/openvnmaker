import { useEffect, useRef, useState } from "react";

interface Props {
  readonly speaker: string | null;
  readonly color: string;
  readonly text: string;
  readonly typing: boolean;
  /** 타이핑이 끝난 전체 문장. 스크린리더에는 글자 단위가 아니라 한 번에 읽힌다. 없으면 text 를 쓴다. */
  readonly fullText?: string | undefined;
  /** 긴 대사가 스크롤 영역이 되면 본문 클릭이 화면 클릭 층에 닿지 않는다 — 그 경우 여기로 진행한다. */
  readonly onAdvance?: (() => void) | undefined;
}

export function DialogueBox({ speaker, color, text, typing, fullText, onAdvance }: Props) {
  const body = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  // 긴 대사는 상한 높이 안에서 스크롤하고, 타이핑 중에는 새로 쓰인 줄을 따라간다.
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const over = node.scrollHeight > node.clientHeight + 1;
    setOverflowing(over);
    if (over && typing) node.scrollTop = node.scrollHeight;
  }, [text, typing]);
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
        {text}
      </p>
      {fullText !== undefined && <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="dialogue-live">{speaker !== null ? `${speaker}: ` : ""}{fullText}</p>}
      {!typing && <span className="next-mark" aria-hidden="true" />}
    </div>
  );
}
