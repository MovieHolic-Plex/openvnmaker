import {LibraryArchiveButton} from "./LibraryArchiveButton.js";
import {useState} from "react";
import {parseScript} from "@vnmaker/content";
import {assertNever} from "@vnmaker/harness";
import {activateProject,saveProject,projectRepository} from "./projects.js";
import {restoreProjectBundle} from "./restoreBundle.js";
import {EDITION,EDITION_KEY} from "../storage/edition.js";
import {emitAuthoringRestored,identifyStudioArchive,restoreAuthoringArchive} from "./harness/authoringArchive.js";

/** Mounted only while bootstrap owns the editor writer lock. */
export function LibraryRecovery({count,onRestored}:{count:number;onRestored:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function restore(file:File){
    setBusy(true);setError("");
    try{
      const zip=file.name.toLowerCase().endsWith(".zip");
      if(!zip && (!file.size || file.size>8*1024*1024))throw new Error("원고 JSON은 8MB 이하로 가져올 수 있습니다.");
      if(zip){
        const kind=await identifyStudioArchive(file);
        switch(kind){
          case "authoring":{
            const payload=await restoreAuthoringArchive(file);
            const id=crypto.randomUUID(),target=await projectRepository.create(id,payload.script);
            target.stage(payload.script,payload.productionDocument);
            const snapshot=await target.flushCurrent();
            localStorage.setItem(EDITION_KEY,EDITION);
            activateProject(id,payload.script,true);
            projectRepository.activate(target);
            emitAuthoringRestored({sourceHead:payload.sourceHead,restoredHead:snapshot.head,archiveHash:payload.archiveHash,importedDraft:payload.candidateSnapshot,receiptAuthority:"reference",autoResume:false});
            onRestored();return;
          }
          case "game-zip":{
            const script=await restoreProjectBundle(file),id=crypto.randomUUID();
            await saveProject(id,script);localStorage.setItem(EDITION_KEY,EDITION);activateProject(id,script,true);
            projectRepository.activate(await projectRepository.open(id));onRestored();return;
          }
          case "unknown":throw new Error("지원하지 않는 ZIP입니다. 게임 ZIP 또는 제작 아카이브를 선택하세요.");
          default:return assertNever(kind);
        }
      }
      const script=parseScript(JSON.parse(await file.text())),id=crypto.randomUUID();
      await saveProject(id,script);localStorage.setItem(EDITION_KEY,EDITION);activateProject(id,script,true);
      projectRepository.activate(await projectRepository.open(id));onRestored();
    }catch(error){setError(`백업을 가져오지 못했습니다: ${error instanceof Error?error.message:String(error)}`);setBusy(false);}
  }
  return <main className="editor-session"><section aria-labelledby="library-recovery-title">
    <span className="eyebrow">PROJECT RECOVERY</span>
    <h1 id="library-recovery-title">백업에서 작품을 복구하세요</h1>
    <p>보관함의 작품 {count}개를 읽지 못했습니다. 원본 데이터를 보존하기 위해 새 작품 초기화를 중단했습니다.</p>
    <p>원고 JSON, 게임 ZIP, 또는 제작 아카이브를 선택하세요. 검증한 백업을 새 작품으로 보관하며 기존 기록은 유지합니다.</p>
    <LibraryArchiveButton disabled={busy}/>
    <label className="project-restore">백업 파일 가져오기<input type="file" accept=".json,.zip,application/json,application/zip" aria-label="복구할 백업 파일" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void restore(file);}}/></label>
    <p>JSON은 원고만 포함하며 이미지·음원은 별도로 필요할 수 있습니다. 게임 ZIP은 포함된 에셋도 복원합니다. 제작 아카이브는 새 lineage로 복원되며 옛 제안 권한은 가져오지 않습니다. JSON 최대 8MB · ZIP 최대 512MB.</p>
    {busy&&<p role="status">백업을 검증하고 새 작품으로 저장하고 있습니다…</p>}
    {error&&<p role="alert">{error}</p>}
    <p>브라우저의 사이트 데이터를 지우지 마세요. 원본 보관함은 삭제하지 않습니다.</p>
  </section></main>;
}
