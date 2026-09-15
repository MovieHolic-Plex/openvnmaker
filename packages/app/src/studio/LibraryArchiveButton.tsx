import {useState} from "react";
import {readLibraryArchive} from "./projects.js";

export function LibraryArchiveButton({disabled=false}:{disabled?:boolean}){
  const [busy,setBusy]=useState(false),[status,setStatus]=useState("");
  async function download(){
    setBusy(true);setStatus("");
    try{
      const raw=await readLibraryArchive();
      const url=URL.createObjectURL(new Blob([raw],{type:"application/json;charset=utf-8"}));
      const anchor=document.createElement("a");anchor.href=url;anchor.download="vnmaker-library-originals.json";anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),5000);
      setStatus("원본 파일 다운로드를 요청했습니다. 저장한 파일을 확인하세요.");
    }catch(error){setStatus(`원본을 내려받지 못했습니다: ${error instanceof Error?error.message:String(error)}`);}
    finally{setBusy(false);}
  }
  return <div><button type="button" className="studio-button" disabled={disabled||busy} onClick={()=>void download()}>보관함 원본 JSON 받기</button><p>정상·손상 원고 기록을 함께 보관합니다. 이미지·음원은 포함되지 않습니다. 이 파일은 복구 화면과 「내 작품」의 백업 가져오기에서 다시 들여올 수 있습니다.</p>{status&&<p role="status">{status}</p>}</div>;
}
