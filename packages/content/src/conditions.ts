import type { Choice, Line, StoryFlags } from "./schema.js";

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
