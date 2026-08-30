import { existsSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUNDS, BGM, CHARACTERS, EXPRESSIONS, SFX } from "./manifest.js";
import type { VnScript } from "./schema.js";

/** 금지 토큰. 콘텐츠 정책: 성인 대학생만 등장하고 교복은 나오지 않는다. */
export const FORBIDDEN_TOKENS = [
  "교복",
  "고등학생",
  "고등학교",
  "중학생",
  "중학교",
  "초등학생",
  "초등학교",
  "아동",
  "어린이",
  "미성년",
  "소년",
  "소녀",
] as const;

const HANGUL = /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/gu;

function allTexts(script: VnScript): string[] {
  const texts: string[] = [];
  for (const scene of script.scenes) {
    for (const line of scene.lines) texts.push(line.text);
    for (const choice of scene.choices ?? []) texts.push(choice.text);
  }
  return texts;
}

/** 대사·내레이션·선택지의 한글 글자 수 합계. 공백과 문장부호는 세지 않는다. */
export function countKoreanChars(script: VnScript): number {
  return allTexts(script).reduce((sum, text) => sum + (text.match(HANGUL)?.length ?? 0), 0);
}

export function findForbiddenTokens(script: VnScript): string[] {
  const haystack = [...allTexts(script), ...script.characters.map((c) => c.bio)].join("\n");
  return FORBIDDEN_TOKENS.filter((token) => haystack.includes(token));
}

/** scene.next / choice.next 가 실제 씬을 가리키는지 확인한다. */
export function findBrokenSceneRefs(script: VnScript): string[] {
  const ids = new Set(script.scenes.map((s) => s.id));
  const broken: string[] = [];
  for (const scene of script.scenes) {
    if (scene.next !== undefined && !ids.has(scene.next)) broken.push(`${scene.id}.next -> ${scene.next}`);
    for (const choice of scene.choices ?? []) {
      if (!ids.has(choice.next)) broken.push(`${scene.id}.choice -> ${choice.next}`);
    }
  }
  return broken;
}

/** 매니페스트에 없는 에셋 id 나 잘못된 인물/표정을 찾는다. */
export function findManifestViolations(script: VnScript): string[] {
  const problems: string[] = [];
  const characterIds = new Set<string>(CHARACTERS);
  const expressions = new Set<string>(EXPRESSIONS);
  for (const scene of script.scenes) {
    if (!(scene.background in BACKGROUNDS)) problems.push(`${scene.id}: 배경 ${scene.background}`);
    if (scene.bgm !== undefined && !(scene.bgm in BGM)) problems.push(`${scene.id}: bgm ${scene.bgm}`);
    for (const dir of scene.sprites ?? []) {
      if (dir.character !== null && !characterIds.has(dir.character)) problems.push(`${scene.id}: 인물 ${dir.character}`);
      if (dir.expression !== undefined && !expressions.has(dir.expression)) {
        problems.push(`${scene.id}: 표정 ${dir.expression}`);
      }
    }
    for (const line of scene.lines) {
      if (line.sfx !== undefined && !(line.sfx in SFX)) problems.push(`${scene.id}: sfx ${line.sfx}`);
      if (line.expression !== undefined && !expressions.has(line.expression)) {
        problems.push(`${scene.id}: 표정 ${line.expression}`);
      }
      if (line.speaker !== null && line.speaker !== "me" && !characterIds.has(line.speaker)) {
        problems.push(`${scene.id}: 화자 ${line.speaker}`);
      }
    }
  }
  return problems;
}

/** 시나리오가 참조하는 에셋 파일이 실제로 디스크에 있는지 본다. */
export function findMissingAssets(script: VnScript, publicDir: string): string[] {
  const wanted = new Set<string>();
  for (const scene of script.scenes) {
    wanted.add(join("bg", `${scene.background}.png`));
    if (scene.bgm !== undefined) wanted.add(join("audio", "bgm", `${scene.bgm}.mp3`));
    for (const dir of scene.sprites ?? []) {
      if (dir.character === null) continue;
      wanted.add(join("sprite", `${dir.character}-${dir.expression ?? "neutral"}.png`));
    }
    for (const line of scene.lines) {
      if (line.sfx !== undefined) wanted.add(join("audio", "sfx", `${line.sfx}.mp3`));
      if (line.expression === undefined) continue;
      for (const dir of scene.sprites ?? []) {
        if (dir.character === null) continue;
        wanted.add(join("sprite", `${dir.character}-${line.expression}.png`));
      }
    }
  }
  return [...wanted].filter((rel) => !existsSync(join(publicDir, rel))).sort();
}
