import type { InlinePart } from "../engine/inlineText.js";

/** resolveInline 이 만든 세그먼트를 스타일 스팬으로 그린다. 백로그·대사창이 같이 쓴다. */
export function InlineText({ parts }: { readonly parts: readonly InlinePart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <span
          key={index}
          className={`${part.bold ? "tx-bold" : ""} ${part.italic ? "tx-italic" : ""}`}
          style={part.color ? { color: part.color } : undefined}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}
