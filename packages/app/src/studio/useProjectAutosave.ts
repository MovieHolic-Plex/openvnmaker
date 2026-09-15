import {useEffect,useRef,useState} from "react";
import type {VnScript} from "@vnmaker/content";
import {PROJECT_KEY,clearQuickRecovery,ownsQuickRecovery,quickRecoveryHash,writeQuickRecovery} from "./project.js";
import {saveProject} from "./projects.js";

export function useProjectAutosave(id:string,script:VnScript,enabled:boolean,retry:number){
  const [result,setResult]=useState<{script:VnScript;id:string;retry:number;pending:boolean;error:string|null}|null>(null);
  const queue=useRef<Promise<void>>(Promise.resolve());
  const latest=useRef({script,enabled});
  latest.current={script,enabled};
  // 이 세션이 마지막으로 쓴(또는 마운트 때 읽어 온) 사본의 해시. 사본을 비웠거나 없으면 null.
  const lastWritten=useRef<string|null>(null);
  const mounted=useRef(script);
  // 마운트 때 저장돼 있는 사본이 우리가 읽어 온 원고 그 자체일 때만 소유한다. 편집기가 열리는 사이 다른 곳이 바꿔 둔 사본을
  // 소유한 것으로 치면 pagehide 가 우리 원고로 그 변경을 덮어쓴다(테스트·복구 절차가 심어 둔 원고가 지워지던 경로).
  useEffect(()=>{try{const raw=localStorage.getItem(PROJECT_KEY);lastWritten.current=raw!==null&&raw===JSON.stringify(mounted.current)?quickRecoveryHash(raw):null;}catch{lastWritten.current=null;}},[]);
  // 600ms 디바운스가 끝나기 전에 탭이 닫히거나 새로고침되면 마지막 편집이 사라진다.
  // 플레이어의 자동 저장과 같이 pagehide/숨김에서 최신 원고를 동기 기록한다.
  useEffect(()=>{
    const flush=()=>{
      const snapshot=latest.current;
      if(!snapshot.enabled)return;
      // 우리가 쓴 사본만 갱신한다. 다른 곳이 사본을 바꾸거나 지웠다면(복구 절차, 다른 도구, 용량 초과로 비운 뒤)
      // 여기서 되살리면 그 변경을 지우고 다음 실행의 복구 판단을 망친다. 원고 자체는 보관함에 있다.
      if(!ownsQuickRecovery(lastWritten.current))return;
      // 실패해도 기존 사본은 둔다 — 여기서는 보관함 저장을 기다릴 수 없어 사본이 보관함보다 오래됐다고 단정할 수 없다.
      try{lastWritten.current=writeQuickRecovery(snapshot.script);}
      catch{/* 디바운스 경로가 저장 실패를 화면에 보고한다. */}
    };
    const onVisibility=()=>{if(document.visibilityState==="hidden")flush();};
    window.addEventListener("pagehide",flush);
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{window.removeEventListener("pagehide",flush);document.removeEventListener("visibilitychange",onVisibility);};
  },[]);
  useEffect(()=>{
    if(!enabled)return;
    let current=true;
    setResult({script,id,retry,pending:true,error:null});
    const timer=window.setTimeout(()=>{
      // Serialize writes so an older async database open cannot commit after a newer snapshot.
      queue.current=queue.current.catch(()=>{}).then(async()=>{
        if(!current)return;
        // 편집할 때마다 전체 원고를 동기 stringify 하면 입력이 버벅인다 — 디바운스 안에서 쓴다.
        let recoveryError:string|null=null;
        // 아직 아무것도 고치지 않은 첫 자동 저장이 다른 곳에서 바뀐 사본을 덮어쓰면 안 된다(복구 절차·다른 도구가 막 바꾼 사본).
        // 편집했거나 사용자가 저장을 눌렀거나 사본이 없으면 평소처럼 쓴다.
        let untouchedForeignCopy=false;
        if(script===mounted.current&&retry===0){try{untouchedForeignCopy=localStorage.getItem(PROJECT_KEY)!==null&&!ownsQuickRecovery(lastWritten.current);}catch{untouchedForeignCopy=false;}}
        if(!untouchedForeignCopy){
          try{lastWritten.current=writeQuickRecovery(script);}
          catch{recoveryError="현재 원고의 빠른 복구 저장에 실패했습니다. JSON으로 백업하세요.";}
        }
        let libraryError:string|null=null;
        try{
          await saveProject(id,script);
          // 사본 쓰기는 실패했고 보관함은 최신이다. 오래된 사본을 남기면 다음 실행이 그 사본을 열고
          // 첫 자동 저장으로 보관함의 최신 원고를 덮어쓴다 — 사본을 비워 보관함에서 열게 한다.
          if(recoveryError){clearQuickRecovery();lastWritten.current=null;}
        }
        catch{libraryError="작품 보관함 저장에 실패했습니다. 현재 원고를 JSON으로 백업하고 다시 저장하세요.";}
        if(current)setResult({script,id,retry,pending:false,error:[recoveryError,libraryError].filter(Boolean).join("\n")||null});
      });
    },600);
    return()=>{current=false;window.clearTimeout(timer);};
  },[id,script,enabled,retry]);
  const matching=result?.script===script&&result.id===id&&result.retry===retry;
  return {pending:enabled&&(!matching||result.pending),error:matching?result.error:null};
}
