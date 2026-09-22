import type { VnScript } from "@vnmaker/content";

export interface TextMatch {
  readonly sceneId: string;
  /** 대사 본문·선택지 문구·입력 문구/placeholder·장 제목·엔딩 제목·배우 이름. */
  readonly kind: "line" | "choice" | "prompt" | "placeholder" | "chapter" | "ending" | "name";
  /** 줄/선택지/배우 인덱스. 장 제목·엔딩은 -1. */
  readonly index: number;
  readonly text: string;
  /** 이 텍스트 안에서 검색어가 나타난 횟수. */
  readonly count: number;
}
export interface FindOptions { readonly caseSensitive?: boolean }

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function pattern(query: string, options: FindOptions): RegExp { return new RegExp(escape(query), options.caseSensitive ? "g" : "gi"); }
const countIn = (regex: RegExp, text: string | undefined) => { if (!text) return 0; regex.lastIndex = 0; let n = 0; while (regex.exec(text)) { n += 1; if (regex.lastIndex === 0) break; } return n; };

/** 대사·선택지·입력 문구·장/엔딩 제목·배우 이름에서 검색어가 들어 있는 항목을 원고 순서대로 모은다. */
export function findText(script: VnScript, query: string, options: FindOptions = {}): TextMatch[] {
  if (!query) return [];
  const regex = pattern(query, options);
  const matches: TextMatch[] = [];
  for (const scene of script.scenes) {
    const push = (kind: TextMatch["kind"], index: number, text: string | undefined) => { const n = countIn(regex, text); if (n) matches.push({ sceneId: scene.id, kind, index, text: text!, count: n }); };
    push("chapter", -1, scene.chapter);
    push("ending", -1, scene.ending);
    scene.lines.forEach((line, index) => { push("line", index, line.text); if (line.input) { push("prompt", index, line.input.prompt); push("placeholder", index, line.input.placeholder); } });
    scene.choices?.forEach((choice, index) => push("choice", index, choice.text));
  }
  script.characters.forEach((actor, index) => { const n = countIn(regex, actor.name); if (n) matches.push({ sceneId: "", kind: "name", index, text: actor.name, count: n }); });
  return matches;
}

/** 행이 밀렸을 때를 대비해 저장된 본문과 같은 항목을 다시 찾는다. 못 찾으면 -1. */
function relocate<T extends { readonly text: string }>(rows: readonly T[] | undefined, index: number, text: string | undefined): number {
  if (!rows) return -1;
  if (text === undefined || rows[index]?.text === text) return index;
  return rows.findIndex(row => row.text === text);
}

/** 한 항목 안의 모든 검색어를 바꾼다. 대상이 옮겨졌으면 저장된 본문으로 다시 찾고, 없으면 원고를 그대로 돌려준다. */
export function replaceInMatch(script: VnScript, match: Pick<TextMatch, "sceneId" | "kind" | "index"> & { readonly text?: string }, query: string, replacement: string, options: FindOptions = {}): VnScript {
  if (!query) return script;
  const regex = pattern(query, options);
  const swap = (text: string) => text.replace(regex, () => replacement);
  if (match.kind === "name") {
    const at = relocate(script.characters.map(actor => ({ text: actor.name })), match.index, match.text);
    if (at < 0) return script;
    return { ...script, characters: script.characters.map((actor, index) => index === at ? { ...actor, name: swap(actor.name) } : actor) };
  }
  return { ...script, scenes: script.scenes.map(scene => {
    if (scene.id !== match.sceneId) return scene;
    if (match.kind === "chapter" || match.kind === "ending") {
      const current = scene[match.kind];
      if (current === undefined || (match.text !== undefined && current !== match.text)) return scene;
      return { ...scene, [match.kind]: swap(current) };
    }
    const at = match.kind === "choice" ? relocate(scene.choices, match.index, match.text) : relocate(scene.lines, match.index, match.text);
    if (at < 0) return scene;
    if (match.kind === "choice") return { ...scene, choices: scene.choices!.map((choice, index) => index === at ? { ...choice, text: swap(choice.text) } : choice) };
    if (match.kind === "prompt" || match.kind === "placeholder") {
      const line = scene.lines[at];
      if (!line?.input) return scene;
      const field = match.kind;
      const current = line.input[field];
      if (current === undefined || (match.text !== undefined && current !== match.text)) return scene;
      return { ...scene, lines: scene.lines.map((row, index) => index === at ? { ...row, input: { ...row.input!, [field]: swap(current) } } : row) };
    }
    return { ...scene, lines: scene.lines.map((line, index) => index === at ? { ...line, text: swap(line.text) } : line) };
  }) };
}

/** 대사·선택지·입력 문구·장/엔딩 제목·배우 이름에서 검색어를 바꾼다. 바뀐 항목이 없는 씬은 같은 객체를 돌려준다. */
export function replaceAll(script: VnScript, query: string, replacement: string, options: FindOptions = {}): { script: VnScript; replaced: number } {
  if (!query) return { script, replaced: 0 };
  const regex = pattern(query, options);
  let replaced = 0;
  const swap = (text: string) => text.replace(regex, () => { replaced += 1; return replacement; });
  const scenes = script.scenes.map(scene => {
    const before = replaced;
    const lines = scene.lines.map(line => {
      const text = swap(line.text);
      const prompt = swap(line.input?.prompt ?? "");
      const placeholder = swap(line.input?.placeholder ?? "");
      const input = line.input && (prompt !== line.input.prompt || placeholder !== line.input.placeholder)
        ? { ...line.input, ...(line.input.prompt !== undefined ? { prompt } : {}), ...(line.input.placeholder !== undefined ? { placeholder } : {}) } : line.input;
      return text === line.text && input === line.input ? line : { ...line, ...(text !== line.text ? { text } : {}), ...(input !== line.input ? { input } : {}) };
    });
    const linesChanged = lines.some((line, index) => line !== scene.lines[index]);
    const choices = scene.choices?.map(choice => { const text = swap(choice.text); return text === choice.text ? choice : { ...choice, text }; });
    const choicesChanged = choices?.some((choice, index) => choice !== scene.choices![index]) ?? false;
    const chapter = scene.chapter === undefined ? undefined : swap(scene.chapter);
    const ending = scene.ending === undefined ? undefined : swap(scene.ending);
    if (replaced === before) return scene;
    return { ...scene, ...(linesChanged ? { lines } : {}), ...(choicesChanged && choices ? { choices } : {}), ...(chapter !== undefined && chapter !== scene.chapter ? { chapter } : {}), ...(ending !== undefined && ending !== scene.ending ? { ending } : {}) };
  });
  const characters = script.characters.map(actor => { const name = swap(actor.name); return name === actor.name ? actor : { ...actor, name }; });
  const castChanged = characters.some((actor, index) => actor !== script.characters[index]);
  return { script: replaced ? { ...script, scenes, ...(castChanged ? { characters } : {}) } : script, replaced };
}
