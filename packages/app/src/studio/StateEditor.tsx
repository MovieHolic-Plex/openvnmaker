import {useEffect,useState} from "react";
import type {Choice,FlagComparison,LineCondition,StoryFlags,VnScript} from "@vnmaker/content";
import "./state-editor.css";

type Value=string|number|boolean;
function ValueField({label,value,onChange}:{label:string;value:Value;onChange:(value:Value)=>void}){
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  if(typeof value==="boolean")return <select aria-label={label} value={String(value)} onChange={event=>onChange(event.target.value==="true")}><option value="false">꺼짐</option><option value="true">켜짐</option></select>;
  return <input aria-label={label} type={typeof value==="number"?"number":"text"} maxLength={200} value={draft} onChange={event=>{setDraft(event.target.value);if(typeof value==="string")onChange(event.target.value);}} onBlur={()=>{if(typeof value==="number"){const number=Number(draft);if(draft.trim()&&Number.isFinite(number))onChange(number);else setDraft(String(value));}}} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();}}/>;
}
const references=(script:VnScript,key:string)=>script.scenes.some(scene=>scene.lines.some(line=>uses(line.when,key))||scene.choices?.some(choice=>Object.hasOwn(choice.set??{},key)||Object.hasOwn(choice.add??{},key)||uses(choice.when,key)));
const uses=(condition:LineCondition|undefined,key:string)=>condition?.all?.includes(key)||condition?.none?.includes(key)||condition?.compare?.some(rule=>rule.flag===key);

export function StateEditor({script,onChange}:{script:VnScript;onChange:(script:VnScript)=>void}){
  const [name,setName]=useState(""),[kind,setKind]=useState("boolean"),[error,setError]=useState("");
  const flags=script.flags??{};
  return <details className="line-direction state-editor"><summary>작품 상태 변수 <span>{Object.keys(flags).length}</span></summary><p className="field-help">새 게임의 초기값입니다. 선택지에서 값을 바꾸고 대사·선택지 조건에 사용할 수 있습니다.</p>
    {Object.entries(flags).map(([key,value])=><div className="state-row" key={key}><label>{key}<ValueField label={`${key} 초기값`} value={value} onChange={next=>onChange({...script,flags:{...flags,[key]:next}})}/></label><button type="button" className="text-button" disabled={references(script,key)} title={references(script,key)?"사용 중인 조건과 선택 결과를 먼저 제거하세요.":"변수 삭제"} aria-label={`${key} 변수 삭제`} onClick={()=>{const next={...flags};delete next[key];onChange({...script,flags:next});}}>삭제</button></div>)}
    <label className="studio-field">새 변수 이름<input aria-label="새 변수 이름" value={name} maxLength={64} placeholder="예: trust, found_letter" onChange={event=>setName(event.target.value)}/></label>
    <div className="state-row"><select aria-label="새 변수 유형" value={kind} onChange={event=>setKind(event.target.value)}><option value="boolean">켜짐 / 꺼짐</option><option value="number">숫자</option><option value="string">문자</option></select><button type="button" className="studio-button" disabled={Object.keys(flags).length>=100} onClick={()=>{const key=name.trim();if(!/^[a-z][a-z0-9_-]{0,63}$/i.test(key)||["constructor","prototype","__proto__"].includes(key)||Object.hasOwn(flags,key)){setError("중복되지 않는 영문 이름을 입력하세요. 숫자·밑줄·하이픈도 사용할 수 있습니다.");return;}onChange({...script,flags:{...flags,[key]:kind==="number"?0:kind==="string"?"":false}});setName("");setError("");}}>변수 추가</button></div>{error&&<p role="alert">{error}</p>}
  </details>;
}

export function ConditionEditor({label,flags,value,onChange}:{label:string;flags:StoryFlags;value:LineCondition|undefined;onChange:(value:LineCondition|undefined)=>void}){
  const names=Object.keys(flags);
  function patch(next:LineCondition){onChange(next.all?.length||next.none?.length||next.compare?.length?next:undefined);}
  function update(index:number,rule:FlagComparison){patch({...value,compare:value!.compare!.map((row,i)=>i===index?rule:row)});}
  return <details className="line-direction condition-editor"><summary>{label} <span>{(value?.all?.length??0)+(value?.none?.length??0)+(value?.compare?.length??0)||"항상"}</span></summary><p className="field-help">아래 조건을 모두 만족할 때 표시합니다. 조건을 전부 지우면 항상 표시합니다.</p>
    {(["all","none"] as const).flatMap(kind=>(value?.[kind]??[]).map((name,index)=><div className="state-row" key={`${kind}-${index}`}><span>{name} · {kind==="all"?"켜짐 / 값 있음":"꺼짐 / 값 없음"}</span><button type="button" className="text-button" aria-label={`${label} ${name} 조건 삭제`} onClick={()=>patch({...value,[kind]:value![kind]!.filter((_,i)=>i!==index)})}>삭제</button></div>))}
    {value?.compare?.map((rule,index)=><div className="condition-rule" key={index}>
      <select aria-label={`${label} 조건 ${index+1} 변수`} value={rule.flag} onChange={event=>update(index,{flag:event.target.value,op:"eq",value:flags[event.target.value]??false})}>{!names.includes(rule.flag)&&<option value={rule.flag}>{rule.flag} (초기값 없음)</option>}{names.map(name=><option key={name}>{name}</option>)}</select>
      <div className="state-row"><select aria-label={`${label} 조건 ${index+1} 비교`} value={rule.op} onChange={event=>update(index,{...rule,op:event.target.value as FlagComparison["op"]})}><option value="eq">같음</option><option value="ne">다름</option>{typeof rule.value==="number"&&<><option value="gte">이상 ≥</option><option value="gt">초과 &gt;</option><option value="lte">이하 ≤</option><option value="lt">미만 &lt;</option></>}</select><ValueField label={`${label} 조건 ${index+1} 값`} value={rule.value} onChange={value=>update(index,{...rule,value})}/><button type="button" className="text-button" aria-label={`${label} 조건 ${index+1} 삭제`} onClick={()=>patch({...value,compare:value!.compare!.filter((_,i)=>i!==index)})}>삭제</button></div>
    </div>)}
    <button className="studio-button full-width" type="button" disabled={!names.length||(value?.compare?.length??0)>=100} onClick={()=>patch({...value,compare:[...(value?.compare??[]),{flag:names[0]!,op:"eq",value:flags[names[0]!]!}]})}>조건 추가</button>{!names.length&&<p className="field-help">작품 상태 변수를 먼저 추가하세요.</p>}
  </details>;
}

export function ChoiceStateEditor({choice,index,flags,onChange}:{choice:Choice;index:number;flags:StoryFlags;onChange:(choice:Choice)=>void}){
  const results={...choice.set,...choice.add};
  const available=Object.keys(flags).filter(key=>!Object.hasOwn(results,key));
  const label=`선택지 ${index+1}`;
  function without(key:string){const set={...choice.set},add={...choice.add};delete set[key];delete add[key];return {...choice,set,add};}
  return <div className="choice-state-editor"><ConditionEditor label={`${label} 표시 조건`} flags={flags} value={choice.when} onChange={when=>{const {when:old,...rest}=choice;onChange(when?{...rest,when}:rest);}}/>
    <details className="line-direction"><summary>선택 결과 <span>{Object.keys(results).length||"변경 없음"}</span></summary><p className="field-help">고정값으로 바꾸거나 숫자를 누적합니다. 증감 값이 3이면 더하고, -3이면 뺍니다.</p>{Object.entries(results).map(([key,value])=>{const adding=Object.hasOwn(choice.add??{},key);return <div className="condition-rule" key={key}><label className="studio-field">{key}<select aria-label={`${label} ${key} 연산`} value={adding?"add":"set"} onChange={event=>{const next=without(key);onChange(event.target.value==="add"?{...next,add:{...next.add,[key]:0}}:{...next,set:{...next.set,[key]:flags[key]??value}});}}><option value="set">고정값 설정</option>{(typeof flags[key]==="number"||adding)&&<option value="add">현재 값에 더하기 / 빼기</option>}</select></label><div className="state-row"><ValueField label={`${label} ${key} 결과`} value={value} onChange={value=>onChange(adding?{...choice,add:{...choice.add,[key]:value as number}}:{...choice,set:{...choice.set,[key]:value}})}/><button type="button" className="text-button" aria-label={`${label} ${key} 결과 삭제`} onClick={()=>onChange(without(key))}>삭제</button></div></div>;})}
      <select aria-label={`${label} 결과 변수 추가`} value="" disabled={!available.length} onChange={event=>{if(event.target.value)onChange({...choice,set:{...choice.set,[event.target.value]:flags[event.target.value]!}});}}><option value="">값을 바꿀 변수 선택</option>{available.map(key=><option key={key}>{key}</option>)}</select>
    </details><label className="check-field"><input type="checkbox" checked={choice.disable??false} onChange={event=>onChange({...choice,disable:event.target.checked})}/>선택 잠금</label>
  </div>;
}
