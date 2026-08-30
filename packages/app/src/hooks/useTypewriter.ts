import { useCallback, useEffect, useRef, useState } from "react";

export interface Typewriter {
  readonly shown: string;
  readonly typing: boolean;
  readonly finish: () => void;
}

/** 한 글자씩 흘려 쓴다. msPerChar 가 0 이하면 즉시 완성한다. */
export function useTypewriter(text: string, msPerChar: number): Typewriter {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setCount(0);
    if (text.length === 0 || msPerChar <= 0) {
      setCount(text.length);
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      const n = Math.min(text.length, Math.floor((now - startedAt) / msPerChar));
      setCount(n);
      if (n < text.length) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [text, msPerChar]);

  const finish = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setCount(text.length);
  }, [text.length]);

  return { shown: text.slice(0, count), typing: count < text.length, finish };
}
