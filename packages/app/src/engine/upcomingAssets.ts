import { characterImage, lineAllowed, validBackgroundUrl, type Scene, type StoryFlags, type VnScript } from "@vnmaker/content";
import { backgroundAt, cgAt, spritesAt } from "./selectors.js";
import { findScene } from "./types.js";

export const PREFETCH_LIMIT = 24;

/** 씬 진입 직후 보일 이미지들(배경·CG·배우). 다음 씬을 미리 받아 전환 때 빈 화면이 나지 않게 한다. */
function sceneOpeningImages(script: VnScript, scene: Scene, flags: StoryFlags): string[] {
  const urls: (string | undefined)[] = [];
  urls.push(cgAt(script, scene, 0, flags) ?? backgroundAt(scene, 0, flags) ?? `/assets/bg/${scene.background}.png`);
  for (const direction of spritesAt(scene, 0, flags)) {
    if (direction.character === null) continue;
    const actor = script.characters.find(character => character.id === direction.character);
    urls.push(direction.poseUrl ?? characterImage(actor ?? { id: direction.character, name: "", bio: "", color: "#ffffff" }, direction.expression ?? "neutral", direction.outfit));
  }
  return urls.filter((url): url is string => validBackgroundUrl(url));
}

/**
 * 현재 위치에서 곧 필요해질 이미지 주소 목록. 같은 씬의 남은 줄에 걸린 배경·CG·포즈와,
 * next 및 모든 선택지가 가리키는 씬의 첫 화면을 모은다. 중복은 제거하고 개수를 제한한다.
 */
export function upcomingImages(script: VnScript, scene: Scene, lineIndex: number, flags: StoryFlags = {}): string[] {
  const urls: string[] = [];
  const push = (url: string | null | undefined) => { if (validBackgroundUrl(url) && !urls.includes(url) && urls.length < PREFETCH_LIMIT) urls.push(url); };
  for (const line of scene.lines.slice(Math.max(0, lineIndex + 1))) {
    if (!lineAllowed(line, flags)) continue;
    push(line.backgroundUrl); push(line.cgUrl);
    for (const direction of line.sprites ?? []) {
      if (direction.character === null) continue;
      const actor = script.characters.find(character => character.id === direction.character);
      push(direction.poseUrl ?? characterImage(actor, direction.expression ?? "neutral", direction.outfit));
    }
  }
  const targets = scene.choices?.length ? scene.choices.map(choice => choice.next) : scene.next ? [scene.next] : [];
  for (const id of targets) {
    const target = findScene(script, id);
    if (!target) continue;
    for (const url of sceneOpeningImages(script, target, flags)) push(url);
  }
  return urls;
}
