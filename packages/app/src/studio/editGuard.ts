import { LIMITS, parseScene, parseScript, type VnScript } from "@vnmaker/content";

/**
 * 편집 결과가 parseScript 를 통과하지 못하면 저장이 거부되고, 새로고침 뒤 샘플 원고가 열린다.
 * 그래서 원고에 넣기 전에 거부 사유를 돌려준다. 키 입력마다 전체를 파싱하면 장편에서 타이핑이 느려지므로
 * 바뀐 씬만 검사하고, 구조가 바뀐 편집(인물·변수·에셋·씬 수·시작 위치)만 전체를 검사한다.
 */
export function editIssue(current: VnScript, next: VnScript): string | null {
  try {
    if (next.scenes.length > LIMITS.scenes) throw new Error(`씬은 최대 ${LIMITS.scenes}개까지 만들 수 있습니다. 씬을 합치거나 새 작품으로 나누세요.`);
    if (next === current) return null;
    const textOnly = next.characters === current.characters && next.flags === current.flags && next.assets === current.assets && next.audioAssets === current.audioAssets && next.start === current.start && next.credits === current.credits && next.scenes.length === current.scenes.length;
    for (const [key, label] of [["title", "작품 제목"], ["subtitle", "작품 설명"]] as const) {
      const value = next[key];
      if (typeof value !== "string" || value.length > LIMITS.text || (key === "title" && !value.trim())) throw new Error(`${label}: 올바른 텍스트가 필요합니다.`);
    }
    const previous = new Map(current.scenes.map(scene => [scene.id, scene]));
    const changed = next.scenes.filter(scene => previous.get(scene.id) !== scene);
    if (!textOnly || changed.length > 3) { parseScript(next); return null; }
    for (const scene of changed) {
      if (scene.lines.length > LIMITS.sceneLines) throw new Error(`한 씬에는 대사를 최대 ${LIMITS.sceneLines.toLocaleString()}줄까지 쓸 수 있습니다. 씬을 나누세요.`);
      parseScene(scene);
    }
    return null;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}
