import {useEffect,useRef,useState} from "react";
import type {VnScript} from "@vnmaker/content";
import {PROJECT_KEY} from "./project.js";
import {saveProject} from "./projects.js";

export function useProjectAutosave(id:string,script:VnScript,enabled:boolean,retry:number){
  const [result,setResult]=useState<{script:VnScript;id:string;retry:number;pending:boolean;error:string|null}|null>(null);
  const queue=useRef<Promise<void>>(Promise.resolve());
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
        try{localStorage.setItem(PROJECT_KEY,JSON.stringify(script));}
        catch{recoveryError="현재 원고의 빠른 복구 저장에 실패했습니다. JSON으로 백업하세요.";}
        let libraryError:string|null=null;
        try{await saveProject(id,script);}catch{libraryError="작품 보관함 저장에 실패했습니다. 현재 원고를 JSON으로 백업하고 다시 저장하세요.";}
        if(current)setResult({script,id,retry,pending:false,error:[recoveryError,libraryError].filter(Boolean).join("\n")||null});
      });
    },600);
    return()=>{current=false;window.clearTimeout(timer);};
  },[id,script,enabled,retry]);
  const matching=result?.script===script&&result.id===id&&result.retry===retry;
  return {pending:enabled&&(!matching||result.pending),error:matching?result.error:null};
}
