import {useEffect,useLayoutEffect,useRef,useState} from "react";
import type {VnScript} from "@vnmaker/content";
import {PROJECT_KEY} from "./project.js";
import type {ProjectRepository} from "./projectRepository.js";

export function useProjectAutosave(repository:ProjectRepository|null,{script,enabled,retry}:{readonly script:VnScript;readonly enabled:boolean;readonly retry:number}){
  const [result,setResult]=useState<{script:VnScript;retry:number;error:string|null}|null>(null);
  const [,render]=useState(0);
  const observed=useRef<{repository:ProjectRepository;script:VnScript}|null>(null);
  useEffect(()=>repository?.subscribe(()=>render(value=>value+1)),[repository]);
  useLayoutEffect(()=>{
    if(!enabled||!repository)return;
    if(observed.current?.repository!==repository){
      observed.current={repository,script:repository.snapshot.script};
    }
    if(observed.current.script!==script){
      if(script!==repository.snapshot.script)repository.stage(script);
      observed.current={repository,script};
    }
  },[repository,script,enabled]);
  useEffect(()=>{
    if(!enabled||!repository)return;
    let current=true;
    let recoveryError:string|null=null;
    try{localStorage.setItem(PROJECT_KEY,JSON.stringify(script));}
    catch{recoveryError="현재 원고의 빠른 복구 저장에 실패했습니다. JSON으로 백업하세요.";}
    setResult({script,retry,error:recoveryError});
    const draft=repository.current;
    const timer=window.setTimeout(()=>{
      void repository.save(draft).then(()=>{
        if(current)setResult({script,retry,error:recoveryError});
      },(error:unknown)=>{
        if(current)setResult({script,retry,error:[recoveryError,`작품 보관함 저장에 실패했습니다. 현재 원고를 JSON으로 백업하고 다시 저장하세요. ${error instanceof Error?error.message:String(error)}`].filter(Boolean).join("\n")});
      });
    },600);
    return()=>{current=false;window.clearTimeout(timer);};
  },[repository,script,enabled,retry]);
  const matching=result?.script===script&&result.retry===retry;
  return {pending:enabled&&(!matching||!repository||repository.dirty),error:matching?result.error:null};
}
