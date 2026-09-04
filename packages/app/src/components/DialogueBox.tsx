interface Props {
  readonly speaker: string | null;
  readonly color: string;
  readonly text: string;
  readonly typing: boolean;
  readonly auto: boolean;
  readonly skipping: boolean;
  readonly onAdvance: () => void;
}

export function DialogueBox({ speaker, color, text, typing, auto, skipping, onAdvance }: Props) {
  const narration = speaker === null;
  return (
    <div
      className={`dialogue-box ${narration ? "is-narration" : ""}`}
      data-testid="dialogue-box"
      onClick={() => {
        // 드래그로 텍스트를 고르는 중이면 진행하지 않는다. 텍스트 선택을 살리기 위한 가드다.
        if (window.getSelection() !== null && !window.getSelection()?.isCollapsed) return;
        onAdvance();
      }}
    >
      <div className="dialogue-paper" />
      {!narration && (
        <div className="speaker-name" data-testid="speaker-name" style={{ color }}>
          {speaker}
        </div>
      )}
      {(auto || skipping) && (
        <div className="mode-badges" aria-hidden="true">
          {auto && (
            <span className="mode-badge is-auto" data-testid="auto-badge">
              AUTO
            </span>
          )}
          {skipping && (
            <span className="mode-badge is-skip" data-testid="skip-badge">
              SKIP
            </span>
          )}
        </div>
      )}
      <p className={`dialogue-text ${narration ? "is-narration" : ""}`} data-testid="dialogue-text">
        {text}
        {!typing && <span className="next-mark" aria-hidden="true" />}
      </p>
      {!typing && (
        <span className="advance-hint" aria-hidden="true">
          click · space
        </span>
      )}
    </div>
  );
}
