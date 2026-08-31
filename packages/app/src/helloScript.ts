import { script } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";

/** W1: 모델이 쓴 한 줄을 PLAY 에 올리기 위한 1씬 스크립트. */
export function helloScript(text: string): VnScript {
  const line = text.trim().replace(/\s+/g, " ");
  if (line === "") throw new Error("빈 대사는 PLAY 에 올리지 않는다");
  return {
    title: "한 줄",
    subtitle: "모델이 방금 썼다",
    start: "hello",
    characters: script.characters,
    scenes: [
      {
        id: "hello",
        chapter: "HELLO",
        background: "title",
        bgm: "main-theme",
        transition: "fade",
        lines: [{ speaker: null, text: line }],
        ending: "그 한 줄",
      },
    ],
  };
}
