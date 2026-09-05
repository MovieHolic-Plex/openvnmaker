interface Props {
  readonly speaker: string | null;
  readonly color: string;
  readonly text: string;
  readonly typing: boolean;
}

export function DialogueBox({ speaker, color, text, typing }: Props) {
  return (
    <div className="dialogue-box" data-testid="dialogue-box">
      <div className="dialogue-paper" />
      {speaker !== null && (
        <div className="speaker-name" data-testid="speaker-name" style={{ color }}>
          {speaker}
        </div>
      )}
      <p className={`dialogue-text ${speaker === null ? "is-narration" : ""}`} data-testid="dialogue-text">
        {text}
      </p>
      {!typing && <span className="next-mark" aria-hidden="true" />}
    </div>
  );
}
