import { choiceAllowed, choiceEffectError, lineAllowed, type Choice, type StoryFlags } from "@vnmaker/content";
import { useEffect, useRef, useState } from "react";
import { resolveText } from "../engine/inlineText.js";

interface Props {
  readonly choices: readonly Choice[];
  readonly flags?: StoryFlags;
  readonly onPick: (index: number) => void;
  readonly onHover: () => void;
}

/** 버튼이 비활성인 이유. 저장 데이터가 원고와 어긋나 「눌러도 반응 없는」 버튼이 되지 않도록 화면에 적는다. */
function disabledReason(choice: Choice, flags: StoryFlags): string | null {
  if (choice.disable) return "아직 선택할 수 없는 길입니다.";
  if (choice.cond) return "이 선택지는 이 플레이어에서 평가할 수 없는 조건을 씁니다.";
  return choiceEffectError(choice, flags) ?? null;
}

export function ChoiceMenu({ choices, flags = {}, onPick, onHover }: Props) {
  const available = choices.flatMap((choice, index) => choiceAllowed(choice, flags) ? [index] : []);
  const [focused, setFocused] = useState(available[0] ?? -1);
  const tabStop = available.includes(focused) ? focused : available[0];
  const visible = choices.filter(choice => lineAllowed(choice, flags)).length;
  const menuRef = useRef<HTMLDivElement>(null);
  // 메뉴를 연 Enter 키가 눌린 채로 남아 있다 — 버튼을 autoFocus 하면 그 keyup 이 첫 번째
  // 선택지를 누른 것으로 처리될 수 있다. 진행 중이던 키 이벤트가 끝난 뒤에 포커스를 옮긴다.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>(`[data-testid="choice-${available[0]}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // 메뉴가 열릴 때 한 번만 — 목록이 바뀌어도 포커스를 빼앗지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="choice-scrim" data-testid="choice-scrim">
      <p className="sr-only" aria-live="polite">선택지 {visible}개. 화살표나 숫자 키로 고를 수 있습니다.</p>
      <div className="choice-menu" ref={menuRef} data-testid="choice-menu" role="menu" aria-label="선택지" onKeyDown={event => {
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
          if(!lineAllowed(choice,flags))return null;
          // 표시 조건은 통과했지만 고를 수 없는 선택지(잠금·조건식·증감 오류)는 비활성으로 그린다.
          const disabled = !available.includes(index);
          const reason = disabled ? disabledReason(choice, flags) : null;
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
              title={reason ?? undefined}
              tabIndex={index === tabStop ? 0 : -1}
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
              <span className="choice-label">{resolveText(choice.text, flags)}{reason && <small className="choice-reason">{reason}</small>}</span>
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
