import type { Choice } from "@vnmaker/content";

interface Props {
  readonly choices: readonly Choice[];
  readonly onPick: (index: number) => void;
  readonly onHover: () => void;
}

export function ChoiceMenu({ choices, onPick, onHover }: Props) {
  return (
    <div className="choice-scrim" data-testid="choice-scrim">
      <div className="choice-menu" data-testid="choice-menu" role="menu" aria-label="선택지">
        {choices.map((choice, index) => {
          const disabled = choice.disable === true;
          return (
            <button
              key={choice.next + choice.text}
              type="button"
              role="menuitem"
              className={`choice-button ${disabled ? "is-disabled" : ""}`}
              data-testid={`choice-${index}`}
              disabled={disabled}
              aria-disabled={disabled}
              autoFocus={index === 0 && !disabled}
              style={{ animationDelay: `${Math.min(index, 8) * 90}ms` }}
              onMouseEnter={onHover}
              onFocus={onHover}
              onClick={() => {
                if (!disabled) onPick(index);
              }}
            >
              <span className="choice-mark" aria-hidden="true">
                ◈
              </span>
              <span className="choice-label">{choice.text}</span>
              <span className="choice-key" aria-hidden="true">
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
