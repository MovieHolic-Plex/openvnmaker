import {useEffect,useState} from "react";

const format=(bytes:number)=>bytes>=1024*1024*1024?`${(bytes/1024/1024/1024).toFixed(2)} GB`:`${Math.max(1,Math.round(bytes/1024/1024))} MB`;
/** 이 사이트가 쓰는 브라우저 저장 공간. 파일 보관함(IndexedDB)이 단조 증가하던 것을 눈에 보이게 한다. */
export function StorageUsage({refreshKey=0}:{refreshKey?:number}){
  const [text,setText]=useState("브라우저 저장 공간을 확인하는 중…");
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try{
        if(!navigator.storage?.estimate){if(alive)setText("이 브라우저는 저장 공간 사용량을 알려주지 않습니다.");return;}
        const {usage,quota}=await navigator.storage.estimate();
        if(alive)setText(`브라우저 저장 공간 ${format(usage??0)} 사용 · ${quota?`${format(quota)} 까지`:"한도 미상"}`);
      }catch{if(alive)setText("저장 공간 사용량을 읽지 못했습니다.");}
    })();
    return()=>{alive=false;};
  },[refreshKey]);
  return <p className="storage-usage" role="status" data-testid="storage-usage">{text}</p>;
}
