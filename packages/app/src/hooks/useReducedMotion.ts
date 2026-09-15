import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** OS 의 「동작 줄이기」 설정. 타이프라이터·전환 페이드를 즉시 완료하는 데 쓴다. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
