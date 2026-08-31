/**
 * C3 증거 리포터. 시나리오 분량과 정책 검사 결과를 사람이 읽을 수 있게 찍는다.
 *
 *   pnpm --filter @vnmaker/content stats
 *
 * 검사 자체는 test/script.test.ts 가 게이트다. 여기는 숫자를 남기는 용도다.
 */
import { resolve } from "node:path";
import {
  FORBIDDEN_TOKENS,
  countKoreanChars,
  findBrokenSceneRefs,
  findForbiddenTokens,
  findManifestViolations,
  findMissingAssets,
} from "./check.js";
import { script } from "./index.js";

const HANGUL = /[\uac00-\ud7a3]/gu;
const PUBLIC_DIR = resolve(import.meta.dirname, "..", "..", "app", "public", "assets");

const total = countKoreanChars(script);
const lineCount = script.scenes.reduce((sum, s) => sum + s.lines.length, 0);
const endings = script.scenes.filter((s) => s.ending !== undefined);

console.log(`작품: ${script.title}`);
console.log(`한글 글자 수(대사+내레이션+선택지): ${total}  [기준 9500..12000]`);
console.log(`씬 ${script.scenes.length}개, 대사 줄 ${lineCount}개, 엔딩 ${endings.length}개`);
console.log(
  `씬별 한글: ${script.scenes
    .map((s) => `${s.id}=${s.lines.reduce((a, l) => a + (l.text.match(HANGUL)?.length ?? 0), 0)}`)
    .join(", ")}`,
);
console.log(`금지 토큰 ${FORBIDDEN_TOKENS.length}개 검사 -> 적발: ${JSON.stringify(findForbiddenTokens(script))}`);
console.log(`깨진 씬 참조: ${JSON.stringify(findBrokenSceneRefs(script))}`);
console.log(`매니페스트 위반: ${JSON.stringify(findManifestViolations(script))}`);
console.log(`없는 에셋: ${JSON.stringify(findMissingAssets(script, PUBLIC_DIR))}`);
console.log(`검사한 금지 토큰 목록: ${FORBIDDEN_TOKENS.join(", ")}`);
