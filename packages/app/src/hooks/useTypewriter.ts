import { useCallback, useEffect, useRef, useState } from "react";

export interface Typewriter {
  readonly shown: string;
  readonly typing: boolean;
  readonly finish: () => void;
}

/** 한 글자씩 흘려 쓴다. msPerChar 가 0 이하면 즉시 완성한다. 속도를 바꿔도 진행은 이어진다 — 재시작하지 않는다. */
export function useTypewriter(text: string, msPerChar: number): Typewriter {
  const [progress, setProgress] = useState({ text, count: 0 });
  // A new, shorter line must not borrow the previous line's completed count
  // while the effect resets the animation after rendering.
  const count = progress.text === text ? progress.count : 0;
  const timerRef = useRef<number | null>(null);
  const msRef = useRef(msPerChar);
  msRef.current = msPerChar;

  useEffect(() => {
    const updateCount = (count: number) => setProgress({ text, count });
    updateCount(0);
    if (text.length === 0 || msRef.current <= 0) {
      updateCount(text.length);
      return;
    }
    const tick = () => {
      timerRef.current = null;
      setProgress(prev => {
        if (prev.text !== text || prev.count >= text.length) return prev;
        timerRef.current = window.setTimeout(tick, Math.max(1, msRef.current));
        return { ...prev, count: prev.count + 1 };
      });
    };
    timerRef.current = window.setTimeout(tick, Math.max(1, msRef.current));
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [text]);

  // 타이핑 도중 즉시 표시로 바꾸면(속도 슬라이더 끝) 남은 글자를 바로 채운다.
  useEffect(() => {
    if (msPerChar <= 0) setProgress(prev => prev.text === text ? { text, count: text.length } : prev);
  }, [text, msPerChar]);

  const finish = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setProgress({ text, count: text.length });
  }, [text]);

  return { shown: text.slice(0, count), typing: count < text.length, finish };
}
