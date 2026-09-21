import { useEffect, useRef, useState } from "react";
import type { LineInput } from "@vnmaker/content";

interface Props {
  readonly input: LineInput;
  readonly onSubmit: (value: string) => void;
}

/**
 * input 줄이 뜨면 대사 진행 대신 이 패널이 값을 받는다.
 * 값이 저장되면 reducer 가 같은 동작으로 다음 줄까지 진행한다 — 패널은 수집만 한다.
 */
export function LineInputPanel({ input, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const max = input.max ?? 16;
  return (
    <form
      className="line-input"
      data-testid="line-input"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <p className="line-input-label">{input.prompt?.trim() || "입력해 주세요"}</p>
      <input
        ref={field}
        value={value}
        maxLength={max}
        placeholder={input.placeholder ?? ""}
        aria-label={input.prompt?.trim() || "입력"}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" data-testid="line-input-submit" disabled={!value.trim()}>확인</button>
    </form>
  );
}
