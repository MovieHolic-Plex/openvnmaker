import { parseScript, type Choice, type FlagComparison, type Line, type LineCondition, type VnScript } from "@vnmaker/content";

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

/** 상태 변수 이름을 바꾸고 초기값·대사 조건·선택지 조건·선택 결과·장면 진입 변수·조건 경로의 참조를 함께 갱신한다. */
export function renameFlag(script: VnScript, from: string, to: string): VnScript {
  const flags = script.flags ?? {};
  if (!Object.hasOwn(flags, from)) throw new Error("바꿀 변수를 찾을 수 없습니다.");
  if (from === to) return script;
  if (!validFlagName(to)) throw new Error("영문자로 시작하는 64자 이하의 영문·숫자·밑줄·하이픈 이름을 사용하세요.");
  if (Object.hasOwn(flags, to)) throw new Error("이미 사용 중인 변수 이름입니다.");
  const line = (row: Line): Line => row.when ? { ...row, when: renameCondition(row.when, from, to) } : row;
  const choice = (row: Choice): Choice => {
    let next: Choice = row;
    if (row.when) next = { ...next, when: renameCondition(row.when, from, to) };
    if (row.set) next = { ...next, set: renameKeys(row.set, from, to) };
    if (row.add) next = { ...next, add: renameKeys(row.add, from, to) };
    return next;
  };
  return parseScript({ ...script, flags: renameKeys(flags, from, to), scenes: script.scenes.map(scene => ({
    ...scene,
    lines: scene.lines.map(line),
    ...(scene.set ? { set: renameKeys(scene.set, from, to) } : {}),
    ...(scene.routes ? { routes: scene.routes.map(route => route.when ? { ...route, when: renameCondition(route.when, from, to) } : route) } : {}),
    ...(scene.choices ? { choices: scene.choices.map(choice) } : {}),
  })) });
}
