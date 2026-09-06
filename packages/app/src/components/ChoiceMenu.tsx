import { choiceAllowed, lineAllowed, type Choice, type StoryFlags } from "@vnmaker/content";
import { useState } from "react";

interface Props {
  readonly choices: readonly Choice[];
  readonly flags?: StoryFlags;
  readonly onPick: (index: number) => void;
  readonly onHover: () => void;
}

export function ChoiceMenu({ choices, flags = {}, onPick, onHover }: Props) {
  const available = choices.flatMap((choice, index) => choiceAllowed(choice, flags) ? [index] : []);
  const [focused, setFocused] = useState(available[0] ?? -1);
  const tabStop = available.includes(focused) ? focused : available[0];
  return (
    <div className="choice-scrim" data-testid="choice-scrim">
      <div className="choice-menu" data-testid="choice-menu" role="menu" aria-label="선택지" onKeyDown={event => {
        if (event.isDefaultPrevented() || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        const position = available.indexOf(focused);
        let next: number | undefined;
        if (event.key === "ArrowDown") next = available[(position + 1) % available.length];
        else if (event.key === "ArrowUp") next = available[(position - 1 + available.length) % available.length];
        else if (event.key === "Home") next = available[0];
        else if (event.key === "End") next = available.at(-1);
        else if (/^[1-8]$/.test(event.key)) {
          event.preventDefault();
          const index = Number(event.key) - 1;
          if (!event.repeat && available.includes(index)) onPick(index);
          return;
        }
        if (next !== undefined) {event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>(`[data-testid="choice-${next}"]`)?.focus();}
      }}>
        {choices.map((choice, index) => {
          if(!lineAllowed(choice,flags)||choice.cond)return null;
          const disabled = choice.disable === true;
          return (
            <button
              key={index}
              type="button"
              role="menuitem"
              className={`choice-button ${disabled ? "is-disabled" : ""}`}
              data-testid={`choice-${index}`}
              disabled={disabled}
              aria-disabled={disabled}
              aria-keyshortcuts={disabled ? undefined : String(index + 1)}
              tabIndex={index === tabStop ? 0 : -1}
              autoFocus={index === available[0]}
              style={{ animationDelay: `${Math.min(index, 8) * 90}ms` }}
              onMouseEnter={onHover}
              onFocus={event => {setFocused(index); event.currentTarget.scrollIntoView({block:"nearest"}); onHover();}}
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
