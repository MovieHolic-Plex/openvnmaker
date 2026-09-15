import type { VnScript } from "@vnmaker/content";

export interface TextMatch {
  readonly sceneId: string;
  /** 대사 본문 또는 선택지 문구. */
  readonly kind: "line" | "choice";
  readonly index: number;
  readonly text: string;
  /** 이 텍스트 안에서 검색어가 나타난 횟수. */
  readonly count: number;
}
export interface FindOptions { readonly caseSensitive?: boolean }

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function pattern(query: string, options: FindOptions): RegExp { return new RegExp(escape(query), options.caseSensitive ? "g" : "gi"); }

/** 대사와 선택지 문구에서 검색어가 들어 있는 항목을 원고 순서대로 모은다. 화자 이름은 대상이 아니다. */
export function findText(script: VnScript, query: string, options: FindOptions = {}): TextMatch[] {
  if (!query) return [];
  const regex = pattern(query, options);
  const count = (text: string) => { regex.lastIndex = 0; let n = 0; while (regex.exec(text)) { n += 1; if (regex.lastIndex === 0) break; } return n; };
  const matches: TextMatch[] = [];
  for (const scene of script.scenes) {
    scene.lines.forEach((line, index) => { const n = count(line.text); if (n) matches.push({ sceneId: scene.id, kind: "line", index, text: line.text, count: n }); });
    scene.choices?.forEach((choice, index) => { const n = count(choice.text); if (n) matches.push({ sceneId: scene.id, kind: "choice", index, text: choice.text, count: n }); });
  }
  return matches;
}

/** 한 항목(대사 한 줄 또는 선택지 하나) 안의 모든 검색어를 바꾼다. 다른 원고는 참조를 그대로 유지한다. */
export function replaceInMatch(script: VnScript, match: Pick<TextMatch, "sceneId" | "kind" | "index">, query: string, replacement: string, options: FindOptions = {}): VnScript {
  if (!query) return script;
  const regex = pattern(query, options);
  return { ...script, scenes: script.scenes.map(scene => {
    if (scene.id !== match.sceneId) return scene;
    if (match.kind === "line") return { ...scene, lines: scene.lines.map((line, index) => index === match.index ? { ...line, text: line.text.replace(regex, () => replacement) } : line) };
    return scene.choices ? { ...scene, choices: scene.choices.map((choice, index) => index === match.index ? { ...choice, text: choice.text.replace(regex, () => replacement) } : choice) } : scene;
  }) };
}

/** 모든 대사·선택지 문구에서 검색어를 바꾼다. 바뀐 항목이 없는 씬은 같은 객체를 돌려준다. */
export function replaceAll(script: VnScript, query: string, replacement: string, options: FindOptions = {}): { script: VnScript; replaced: number } {
  if (!query) return { script, replaced: 0 };
  const regex = pattern(query, options);
  let replaced = 0;
  const swap = (text: string) => text.replace(regex, () => { replaced += 1; return replacement; });
  const scenes = script.scenes.map(scene => {
    const before = replaced;
    const lines = scene.lines.map(line => { const text = swap(line.text); return text === line.text ? line : { ...line, text }; });
    const linesChanged = lines.some((line, index) => line !== scene.lines[index]);
    const choices = scene.choices?.map(choice => { const text = swap(choice.text); return text === choice.text ? choice : { ...choice, text }; });
    const choicesChanged = choices?.some((choice, index) => choice !== scene.choices![index]) ?? false;
    if (replaced === before) return scene;
    return { ...scene, ...(linesChanged ? { lines } : {}), ...(choicesChanged && choices ? { choices } : {}) };
  });
  return { script: replaced ? { ...script, scenes } : script, replaced };
}
