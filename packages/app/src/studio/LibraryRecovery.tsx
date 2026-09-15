import {LibraryArchiveButton} from "./LibraryArchiveButton.js";
import {useState} from "react";
import {parseScript,type VnScript} from "@vnmaker/content";
import {activateProject,restoreLibraryArchive,saveProject} from "./projects.js";
import {restoreProjectBundle} from "./restoreBundle.js";
import {isLibraryArchive} from "./libraryArchive.js";
import {EDITION,EDITION_KEY} from "../storage/edition.js";

const MAX_JSON=64*1024*1024;
/** Mounted only while bootstrap owns the editor writer lock. */
export function LibraryRecovery({count,onRestored}:{count:number;onRestored:(script:VnScript)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState("");
  async function restore(file:File){
    setBusy(true);setError("");setStatus("");
    try{
      const zip=file.name.toLowerCase().endsWith(".zip");
      if(!zip && (!file.size || file.size>MAX_JSON))throw new Error("원고·보관함 JSON은 64MB 이하로 가져올 수 있습니다.");
      let id:string=crypto.randomUUID(),script:VnScript,note="";
      if(zip){script=await restoreProjectBundle(file);await saveProject(id,script);}
      else{
        const text=await file.text();
        let value:unknown;try{value=JSON.parse(text);}catch{throw new Error("JSON을 읽지 못했습니다.");}
        if(isLibraryArchive(value)){
          // 보관함 원본: 읽을 수 있는 기록을 모두 새 작품으로 저장하고 가장 최근 것을 연다.
          const result=await restoreLibraryArchive(text);
          const latest=result.restored[0]!;id=latest.id;script=latest.script;
          note=`보관함 원본에서 작품 ${result.restored.length}개를 복구했습니다.${result.skipped?` 읽을 수 없는 기록 ${result.skipped}개는 건너뛰었습니다.`:""}`;
        }else{script=parseScript(value);await saveProject(id,script);}
      }
      try{localStorage.setItem(EDITION_KEY,EDITION);}catch{/* 용량 초과 — 판본 표시는 다음 저장에서. */}
      activateProject(id,script);
      if(note)setStatus(note);
      onRestored(script);
    }catch(error){setError(`백업을 가져오지 못했습니다: ${error instanceof Error?error.message:String(error)}`);setBusy(false);}
  }
  return <main className="editor-session"><section aria-labelledby="library-recovery-title">
    <span className="eyebrow">PROJECT RECOVERY</span>
    <h1 id="library-recovery-title">백업에서 작품을 복구하세요</h1>
    <p>보관함의 작품 {count}개를 읽지 못했습니다. 원본 데이터를 보존하기 위해 새 작품 초기화를 중단했습니다.</p>
    <p>원고 JSON, 이 편집기에서 내보낸 게임 ZIP, 또는 「보관함 원본 JSON」을 선택하세요. 검증한 백업을 새 작품으로 보관하며 기존 기록은 유지합니다.</p>
    <LibraryArchiveButton disabled={busy}/>
    <label className="project-restore">백업 파일 가져오기<input type="file" accept=".json,.zip,application/json,application/zip" aria-label="복구할 백업 파일" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void restore(file);}}/></label>
    <p>JSON은 원고만 포함하며 이미지·음원은 별도로 필요할 수 있습니다. 게임 ZIP은 포함된 에셋도 복원합니다. JSON 최대 64MB · ZIP 최대 512MB.</p>
    {busy&&<p role="status">{status||"백업을 검증하고 새 작품으로 저장하고 있습니다…"}</p>}
    {error&&<p role="alert">{error}</p>}
    <p>브라우저의 사이트 데이터를 지우지 마세요. 원본 보관함은 삭제하지 않습니다.</p>
  </section></main>;
}
