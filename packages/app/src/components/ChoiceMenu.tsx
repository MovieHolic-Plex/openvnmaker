import type { Choice } from "@vnmaker/content";

interface Props {
  readonly choices: readonly Choice[];
  readonly onPick: (index: number) => void;
  readonly onHover: () => void;
}

export function ChoiceMenu({ choices, onPick, onHover }: Props) {
  return (
    <div className="choice-menu" data-testid="choice-menu">
      {choices.map((choice, index) => (
        <button
          key={choice.next + choice.text}
          type="button"
          className="choice-button"
          data-testid={`choice-${index}`}
          onMouseEnter={onHover}
          onClick={() => onPick(index)}
        >
          <span className="choice-mark">◈</span>
          {choice.text}
        </button>
      ))}
    </div>
  );
}
