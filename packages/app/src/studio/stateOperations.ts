import { parseScript, type Choice, type FlagComparison, type Line, type LineCondition, type VnScript } from "@vnmaker/content";

const conditionFlags = (condition: LineCondition | undefined, into: Set<string>) => { condition?.all?.forEach(key => into.add(key)); condition?.none?.forEach(key => into.add(key)); condition?.compare?.forEach(rule => into.add(rule.flag)); };
/** 원고를 한 번 훑어 참조 중인 변수 집합을 만든다. renameFlag 가 갱신하는 모든 자리를 센다 — 대사·선택지·조건 경로의 조건, 선택 결과, 장면 진입 변수, 입력 저장 변수. */
export function referencedFlags(script: VnScript): Set<string> {
  const into = new Set<string>();
  for (const scene of script.scenes) {
    for (const key of Object.keys(scene.set ?? {})) into.add(key);
    for (const route of scene.routes ?? []) conditionFlags(route.when, into);
    for (const line of scene.lines) { conditionFlags(line.when, into); if (line.input) into.add(line.input.flag); }
    for (const choice of scene.choices ?? []) { conditionFlags(choice.when, into); for (const key of Object.keys(choice.set ?? {})) into.add(key); for (const key of Object.keys(choice.add ?? {})) into.add(key); }
  }
  return into;
}

const FLAG_NAME = /^[a-z][a-z0-9_-]{0,63}$/i;
export function validFlagName(value: string): boolean { return FLAG_NAME.test(value) && !["constructor", "prototype", "__proto__"].includes(value); }

function renameCondition(condition: LineCondition, from: string, to: string): LineCondition {
  const swap = (names: readonly string[]) => names.map(name => name === from ? to : name);
  const next: { all?: readonly string[]; none?: readonly string[]; compare?: readonly FlagComparison[] } = {};
  if (condition.all) next.all = swap(condition.all);
  if (condition.none) next.none = swap(condition.none);
  if (condition.compare) next.compare = condition.compare.map(rule => rule.flag === from ? { ...rule, flag: to } : rule);
  return next;
}
function renameKeys<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  if (!Object.hasOwn(record, from)) return record;
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key === from ? to : key, value]));
}

/** 상태 변수 이름을 바꾸고 초기값·대사 조건·입력 저장 변수·선택지 조건·선택 결과·장면 진입 변수·조건 경로의 참조를 함께 갱신한다. */
export function renameFlag(script: VnScript, from: string, to: string): VnScript {
  const flags = script.flags ?? {};
  if (!Object.hasOwn(flags, from)) throw new Error("바꿀 변수를 찾을 수 없습니다.");
  if (from === to) return script;
  if (!validFlagName(to)) throw new Error("영문자로 시작하는 64자 이하의 영문·숫자·밑줄·하이픈 이름을 사용하세요.");
  if (Object.hasOwn(flags, to)) throw new Error("이미 사용 중인 변수 이름입니다.");
  // {flag:이름}·{player} 토큰도 참조다 — 본문을 안 고치면 이름을 바꾼 뒤 그 자리가 빈 문자열로 렌더된다.
  const renameTokens = (text: string): string => {
    let next = text.replaceAll(`{flag:${from}}`, `{flag:${to}}`);
    if (from === "player") next = next.replaceAll("{player}", `{flag:${to}}`);
    return next;
  };
  const line = (row: Line): Line => {
    let next: Line = row;
    const text = renameTokens(row.text);
    if (text !== row.text) next = { ...next, text };
    if (row.when) next = { ...next, when: renameCondition(row.when, from, to) };
    if (row.input) {
      const input = {
        ...row.input,
        ...(row.input.flag === from ? { flag: to } : {}),
        ...(row.input.prompt !== undefined ? { prompt: renameTokens(row.input.prompt) } : {}),
        ...(row.input.placeholder !== undefined ? { placeholder: renameTokens(row.input.placeholder) } : {}),
      };
      if (input.flag !== row.input.flag || input.prompt !== row.input.prompt || input.placeholder !== row.input.placeholder) next = { ...next, input };
    }
    return next;
  };
  const choice = (row: Choice): Choice => {
    let next: Choice = row;
    const text = renameTokens(row.text);
    if (text !== row.text) next = { ...next, text };
    if (row.when) next = { ...next, when: renameCondition(row.when, from, to) };
    if (row.set) next = { ...next, set: renameKeys(row.set, from, to) };
    if (row.add) next = { ...next, add: renameKeys(row.add, from, to) };
    return next;
  };
  return parseScript({ ...script, flags: renameKeys(flags, from, to),
    characters: script.characters.map(actor => { const name = renameTokens(actor.name); return name === actor.name ? actor : { ...actor, name }; }),
    scenes: script.scenes.map(scene => ({
    ...scene,
    lines: scene.lines.map(line),
    ...(scene.set ? { set: renameKeys(scene.set, from, to) } : {}),
    ...(scene.routes ? { routes: scene.routes.map(route => route.when ? { ...route, when: renameCondition(route.when, from, to) } : route) } : {}),
    ...(scene.choices ? { choices: scene.choices.map(choice) } : {}),
  })) });
}
