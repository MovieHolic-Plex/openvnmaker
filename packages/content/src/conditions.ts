import type { Choice, Line, StoryFlags } from "./schema.js";

/**
 * 표시 조건 평가. 웹 플레이어와 Ren'Py 출력(renpyScript.ts 의 `vn_condition`)이 같은 규칙을 따른다.
 * - `all`: 모든 플래그가 참이어야 한다. 숫자 0, 빈 문자열, false, 미존재는 거짓으로 본다.
 * - `none`: 모든 플래그가 거짓(또는 미존재)이어야 한다.
 * - `compare`: 플래그가 **없으면 어떤 연산자든 false** 다 — `ne` 도 예외가 아니다. "값이 다르다"가 아니라
 *   "값이 있고 다르다"를 뜻한다. `eq`/`ne` 는 타입까지 엄격히 비교하고(1 과 "1" 은 다르다),
 *   크기 비교는 양쪽이 모두 숫자일 때만 참이 될 수 있다.
 */
export function lineAllowed(line: Pick<Line, "when">, flags: StoryFlags = {}): boolean {
  return (line.when?.all ?? []).every(key => Boolean(Object.hasOwn(flags,key) && flags[key])) && (line.when?.none ?? []).every(key => !Object.hasOwn(flags,key) || !flags[key]) && (line.when?.compare ?? []).every(({flag,op,value}) => {
    if (!Object.hasOwn(flags,flag)) return false;
    const actual=flags[flag];
    if(op==="eq")return actual===value;
    if(op==="ne")return actual!==value;
    if(typeof actual!=="number"||typeof value!=="number")return false;
    return op==="gt"?actual>value:op==="gte"?actual>=value:op==="lt"?actual<value:actual<=value;
  });
}

export function choiceAllowed(choice: Choice, flags: StoryFlags = {}): boolean {
  return !choice.disable && !choice.cond && lineAllowed(choice,flags) && !choiceEffectError(choice,flags);
}

export function choiceEffectError(choice:Pick<Choice,"set"|"add">,flags:StoryFlags):string|undefined{
  for(const [key,delta] of Object.entries(choice.add??{})){
    if(Object.hasOwn(choice.set??{},key))return `${key}: 고정값 설정과 증감을 동시에 지정할 수 없습니다.`;
    const current=flags[key];
    if(!Object.hasOwn(flags,key)||typeof current!=="number"||typeof delta!=="number"||!Number.isFinite(current)||!Number.isFinite(delta))return `${key}: 증감하려면 현재 값과 변화량이 숫자여야 합니다.`;
    if(!Number.isFinite(current+delta))return `${key}: 증감 결과가 숫자 범위를 넘습니다.`;
  }
}

/** Validate all numeric effects before constructing a fresh, rollback-safe flag snapshot. */
export function applyChoiceFlags(flags:StoryFlags,choice:Pick<Choice,"set"|"add">):StoryFlags{
  const error=choiceEffectError(choice,flags);if(error)throw new Error(error);
  return Object.fromEntries([...Object.entries(flags),...Object.entries(choice.set??{}),...Object.entries(choice.add??{}).map(([key,delta])=>[key,(flags[key] as number)+delta])]);
}
