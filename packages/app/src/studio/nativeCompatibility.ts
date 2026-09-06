import type {VnScript} from "@vnmaker/content";

export type CompatibilitySeverity="high"|"review"|"info";
export interface CompatibilityIssue {code:string;severity:CompatibilitySeverity;scope:string;message:string}
export interface CompatibilityAnalysis {version:1;status:"requires-review"|"informational"|"no-detected-changes";counts:Record<CompatibilitySeverity,number>;issues:CompatibilityIssue[];omitted:number;limitations:string[]}
export interface NativeCompatibilityReport {version:1;baseline:{jobId:string;artifactSha256:string;manuscriptHash:string};currentManuscriptHash:string;analysis:CompatibilityAnalysis}
const clip=(text:string)=>text.length>140?text.slice(0,137)+"…":text;
/** Object key order is not a change; array order remains meaningful. */
function canonical(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.entries(value).filter(([,value])=>value!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>JSON.stringify(key)+":"+canonical(value)).join(",")+"}";
  return JSON.stringify(value)??"undefined";
}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
/** Match equal occurrences in order; an inversion proves that surviving anchors moved. O(n). */
function reordered(before:readonly string[],after:readonly string[]):boolean{
  const positions=new Map<string,number[]>(),used=new Map<string,number>();before.forEach((key,index)=>{const rows=positions.get(key)??[];rows.push(index);positions.set(key,rows);});
  let last=-1;for(const key of after){const index=used.get(key)??0,old=positions.get(key)?.[index];if(old===undefined)continue;used.set(key,index+1);if(old<last)return true;last=old;}return false;
}

function identified<T extends {readonly id?:string}>(before:readonly T[],after:readonly T[]):boolean {
  const valid=(rows:readonly T[])=>rows.every(row=>typeof row.id==="string"&&row.id.length>0)&&new Set(rows.map(row=>row.id)).size===rows.length;
  return before.length+after.length>0 && valid(before)&&valid(after);
}

/** Conservative manuscript comparison, not an execution/old-save compatibility proof. */
export function compareNativeManuscripts(before:VnScript,after:VnScript):CompatibilityAnalysis{
  const retained:Record<CompatibilitySeverity,CompatibilityIssue[]>={high:[],review:[],info:[]},counts={high:0,review:0,info:0};
  function add(code:string,severity:CompatibilitySeverity,scope:string,message:string){counts[severity]++;if(retained[severity].length<400)retained[severity].push({code,severity,scope:clip(scope),message});}
  if(before.nativeSaveId!==after.nativeSaveId)add("release-id",before.nativeSaveId&&after.nativeSaveId?"high":"info","작품","배포 ID가 변경되거나 추가됐습니다. 같은 저장 폴더를 사용하는지 확인하세요.");
  if(before.title!==after.title||before.subtitle!==after.subtitle)add("title","info","작품","작품 제목 또는 설명이 변경됐습니다.");
  if(before.start!==after.start)add("start","review","작품","새 게임의 시작 장면이 변경됐습니다. 기존 저장에서 이어지는 경로도 확인하세요.");
  if((before.musicFadeSeconds??1.2)!==(after.musicFadeSeconds??1.2))add("music-fade","review","작품 음악",`음악 시작·교체·정지 시간이 ${before.musicFadeSeconds??1.2}초에서 ${after.musicFadeSeconds??1.2}초로 변경됐습니다. 이전 저장 복원과 장면 전환에서 음악을 확인하세요.`);
  const oldFlags=before.flags??{},newFlags=after.flags??{};
  for(const key of Object.keys(oldFlags)){
    if(!Object.hasOwn(newFlags,key))add("flag-removed","high",`변수 ${key}`,"변수가 삭제됐습니다. 이전 세이브에는 이 키가 남습니다. 이름 변경도 자동으로 이전되지 않습니다.");
    else if(typeof oldFlags[key]!==typeof newFlags[key])add("flag-type","high",`변수 ${key}`,"변수 타입이 변경됐습니다. 이전 세이브의 값은 자동 변환되지 않으므로 비교·증감 동작을 확인하세요.");
    else if(oldFlags[key]!==newFlags[key])add("flag-default","review",`변수 ${key}`,"초기값이 변경됐습니다. 기존 세이브의 획득한 값은 유지되어 새 게임과 값이 다를 수 있습니다.");
  }
  for(const key of Object.keys(newFlags))if(!Object.hasOwn(oldFlags,key))add("flag-added","info",`변수 ${key}`,"새 변수입니다. 이전 세이브에 키가 없을 때만 새 초기값을 채웁니다.");
  const oldActors=new Map(before.characters.map((actor,index)=>[actor.id,{actor,index}])),newActors=new Map(after.characters.map((actor,index)=>[actor.id,{actor,index}]));
  let actorOrder=false;
  for(const [id,old] of oldActors){const next=newActors.get(id);if(!next)add("actor-removed","high",`배우 ${id}`,"배우가 삭제됐습니다. 이전 세이브의 배우 배치와 대사 화자를 확인하세요.");else{if(old.index!==next.index)actorOrder=true;if(!same(old.actor,next.actor))add("actor-changed","review",`배우 ${id}`,"이름·표정·원화 등 배우 설정이 변경됐습니다. 저장된 배치와 화자 표시를 확인하세요.");}}
  if(actorOrder)add("actor-order","high","배우 목록","기존 배우의 등록 위치가 바뀌었습니다. 네이티브 화자 참조가 달라질 수 있습니다.");
  for(const id of newActors.keys())if(!oldActors.has(id))add("actor-added","info",`배우 ${id}`,"새 배우가 추가됐습니다.");
  const oldScenes=new Map(before.scenes.map(scene=>[scene.id,scene])),newScenes=new Map(after.scenes.map(scene=>[scene.id,scene]));
  if(!same(before.scenes.map(scene=>scene.id),after.scenes.map(scene=>scene.id))&&oldScenes.size===newScenes.size&&[...oldScenes.keys()].every(id=>newScenes.has(id)))add("scene-order","info","장면 목록","장면 배열 순서가 변경됐습니다. 현재 내보내기는 ID 순서로 코드를 배치하지만 실제 이전 세이브 복원은 확인해야 합니다.");
  for(const [id,old] of oldScenes){
    const next=newScenes.get(id),scope=`장면 ${id}`;
    if(!next){add("scene-removed","high",scope,"장면이 삭제되거나 ID가 바뀌었습니다. 이 장면을 가리키는 이전 저장 위치가 사라집니다.");continue;}
    if(old.lines.length!==next.lines.length)add("line-count","high",scope,`대사가 ${old.lines.length}줄에서 ${next.lines.length}줄로 변경됐습니다. 줄 삽입·삭제 시 이전 저장 위치 검증이 필요합니다.`);
    const lineIds=identified(old.lines,next.lines);
    const oldLinesById=new Map(old.lines.map(line=>[line.id,line]));
    if(lineIds){
      const newIds=new Set(next.lines.map(line=>line.id));
      for(const line of old.lines)if(!newIds.has(line.id))add("line-removed","high",`${scope} · 대사 ${line.id}`,"대사 ID가 삭제되거나 변경됐습니다. 이전 저장의 대상 문장이 사라질 수 있습니다.");
      for(const line of next.lines)if(!oldLinesById.has(line.id))add("line-added","review",`${scope} · 대사 ${line.id}`,"새 대사 ID입니다. 기존 세이브가 새 대사를 읽게 되는지 확인하세요.");
    }
    const signature=(line:{id?:string;text:string;speaker:unknown})=>lineIds?line.id!:canonical([line.speaker,line.text]);
    if(reordered(old.lines.map(signature),next.lines.map(signature)))add("line-order","high",scope,"남아 있는 대사의 순서가 바뀌었습니다. 대사와 선택지 앞뒤의 이전 저장을 각각 확인하세요.");
    if(!same(old.lines,next.lines)){
      let text=false,cues=false;
      for(let index=0;index<next.lines.length;index++){
        const previous=lineIds?oldLinesById.get(next.lines[index]!.id):old.lines[index];
        if(!previous)continue;
        const {text:ot,speaker:os,id:oi,...or}=previous,{text:nt,speaker:ns,id:ni,...nr}=next.lines[index]!;
        if(ot!==nt||os!==ns)text=true;if(!same(or,nr))cues=true;
      }
      if(text)add("dialogue-changed","review",scope,"대사 문구 또는 화자가 변경됐습니다. 텍스트만 수정해도 복원 위치가 달라질 수 있습니다.");
      if(cues)add("line-cues","review",scope,"대사별 표시 조건·음원·이미지·연출이 변경됐습니다. 저장 직후 재생과 되감기를 확인하세요.");
    }
    const oc=old.choices??[],nc=next.choices??[];
    if(oc.length!==nc.length)add("choice-count","high",scope,`선택지가 ${oc.length}개에서 ${nc.length}개로 변경됐습니다. 이전 선택지 저장을 복원해 선택과 분기를 확인하세요.`);
    const choiceIds=identified(oc,nc),oldChoicesById=new Map(oc.map(choice=>[choice.id,choice]));
    if(choiceIds){
      const newIds=new Set(nc.map(choice=>choice.id));
      for(const choice of oc)if(!newIds.has(choice.id))add("choice-removed","high",`${scope} · 선택 ${choice.id}`,"선택지 ID가 삭제되거나 변경됐습니다. 이전 선택 메뉴 저장을 확인하세요.");
      for(const choice of nc)if(!oldChoicesById.has(choice.id))add("choice-added","review",`${scope} · 선택 ${choice.id}`,"새 선택지 ID입니다. 기존 상태에서의 표시와 결과를 확인하세요.");
    }
    if(reordered(oc.map(choice=>choiceIds?choice.id!:choice.text),nc.map(choice=>choiceIds?choice.id!:choice.text)))add("choice-order","high",scope,"선택지 순서가 변경됐습니다. 저장 당시의 선택 결과가 다른 분기로 연결되지 않는지 확인하세요.");
    const oldTextCounts=new Map<string,number>(),newTextCounts=new Map<string,number>();
    for(const choice of oc)oldTextCounts.set(choice.text,(oldTextCounts.get(choice.text)??0)+1);
    for(const choice of nc)newTextCounts.set(choice.text,(newTextCounts.get(choice.text)??0)+1);
    const oldByText=new Map(oc.map(choice=>[choice.text,choice]));
    for(let index=0;index<nc.length;index++){
      const nextChoice=nc[index]!;
      // Unique surviving captions anchor logic across reorders; ambiguous captions use position.
      const oldChoice=choiceIds?oldChoicesById.get(nextChoice.id):oldTextCounts.get(nextChoice.text)===1&&newTextCounts.get(nextChoice.text)===1?oldByText.get(nextChoice.text):oc[index];
      if(!oldChoice)continue;
      const {text:ot,id:oi,...or}=oldChoice,{text:nt,id:ni,...nr}=nextChoice;
      if(!same(or,nr))add("choice-logic","high",`${scope} · 선택 ${index+1}`,"선택지의 목적지·조건·결과가 변경됐습니다. 기존 상태에서 잠긴 선택지와 누적 결과를 확인하세요.");
      if(ot!==nt)add("choice-caption","review",`${scope} · 선택 ${index+1}`,"선택지 문구가 변경됐습니다. 이전 선택지 저장의 복원 위치를 확인하세요.");
    }
    if(old.next!==next.next||old.ending!==next.ending)add("scene-exit","high",scope,"장면의 다음 경로 또는 엔딩이 변경됐습니다. 기존 진행 중 세이브의 도달 경로를 확인하세요.");
    const {lines:ol,choices:ocs,next:on,ending:oe,...oldStage}=old,{lines:nl,choices:ncs,next:nn,ending:ne,...newStage}=next;
    if(!same(oldStage,newStage))add("scene-cues","review",scope,"배경·음악·배우 배치 등 장면 설정이 변경됐습니다. 이전 저장의 연출 상태가 그대로 남을 수 있습니다.");
  }
  for(const id of newScenes.keys())if(!oldScenes.has(id))add("scene-added","info",`장면 ${id}`,"새 장면입니다. 기존 세이브에서도 의도한 경로로 도달하는지 확인하세요.");
  const {nativeSaveId:oi,title:ot,subtitle:os,start:ost,flags:of,characters:oc,scenes:osc,musicFadeSeconds:om,...oldExtra}=before,{nativeSaveId:ni,title:nt,subtitle:ns,start:nst,flags:nf,characters:nc,scenes:nsc,musicFadeSeconds:nm,...newExtra}=after;
  if(!same(oldExtra,newExtra))add("library-metadata","info","작품 보관함","원화·음원 목록 또는 기타 작품 정보가 변경됐습니다. 같은 파일 경로의 실제 바이트 변경은 이 검사로 알 수 없습니다.");
  const total=counts.high+counts.review+counts.info;
  const issues=[...retained.high,...retained.review,...retained.info].slice(0,400);
  return {version:1,status:counts.high||counts.review?"requires-review":counts.info?"informational":"no-detected-changes",counts,issues,omitted:total-issues.length,limitations:["정적 원고 비교입니다. 실제 이전 세이브를 실행하거나 호환성을 보장하지 않습니다.","양쪽 목록에 고유 ID가 모두 있으면 ID로 비교합니다. ID가 없거나 일부만 있으면 문구·위치 추정을 사용합니다. 이 ID를 실제 저장 복원 위치에 연결하지는 않습니다.","동일 경로의 파일 바이트, SDK·플랫폼 변경, 사용자 정의 코드와 모든 과거 출시본은 검사하지 않습니다."]};
}
