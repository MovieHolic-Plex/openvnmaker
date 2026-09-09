import {LibraryArchiveButton} from "./LibraryArchiveButton.js";
import {createPortal} from "react-dom";
import {useEffect,useRef,useState} from "react";
import {parseScript,type VnScript} from "@vnmaker/content";
import {listProjects,listProposalDecisions,newProject,type SavedProject} from "./projects.js";
import {projectRepository,type ProjectRepository} from "./projectRepository.js";
import {Icon} from "./Icon.js";
import {restoreProjectBundle} from "./restoreBundle.js";
import {folderPickerSupported,openProjectFolder,pickProjectFolder,saveProjectFolder,type FolderProgress} from "./projectFolder.js";
import {PRODUCTION_KEY} from "./production.js";
import {
  buildAuthoringArchive, emitAuthoringRestored, parseLegacyProductionCheckpoint, productionDocumentFromLegacy,
  restoreAuthoringArchive,
} from "./harness/authoringArchive.js";
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),5000);}
export function ProjectLibrary({script,activeId,repository,onSwitch}:{script:VnScript;activeId:string;repository:ProjectRepository|null;onSwitch:(repository:ProjectRepository)=>void}){
  const[open,setOpen]=useState(false),[rows,setRows]=useState<SavedProject[]>([]),[busy,setBusy]=useState(false),[title,setTitle]=useState(""),[error,setError]=useState("");
  const [damagedCount,setDamagedCount]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),latest=useRef(script);latest.current=script;
  const[folderStatus,setFolderStatus]=useState("");
  const[legacyPresent,setLegacyPresent]=useState(false),[legacyDownloaded,setLegacyDownloaded]=useState(false),[legacyConfirmed,setLegacyConfirmed]=useState(false);
  const progress=({phase,complete,total}:FolderProgress)=>setFolderStatus(`${phase==="save"?"폴더에 저장":phase==="check"?"원본 확인":"작품 가져오기"} · ${complete} / ${total}`);
  async function folderAction(action:"save"|"open"){
    const before=script;setBusy(true);setError("");setFolderStatus("");
    try{
      const directory=await pickProjectFolder(action==="save"?"readwrite":"read");
      if(action==="save"){const name=await saveProjectFolder(directory,before,progress);setFolderStatus(`저장 완료 · ${name}`);}
      else{const next=await openProjectFolder(directory,progress);if(latest.current!==before)throw new Error("가져오는 중 원고가 변경되어 전환을 중단했습니다.");await switchProject(crypto.randomUUID(),next);setFolderStatus("");}
    }catch(error){setFolderStatus("");if(!(error instanceof DOMException&&error.name==="AbortError"))setError(`폴더 작업 실패: ${error instanceof Error?error.message:String(error)}`);}
    finally{setBusy(false);}
  }
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  async function show(){setOpen(true);setBusy(true);setError("");setLegacyDownloaded(false);setLegacyConfirmed(false);setLegacyPresent(localStorage.getItem(PRODUCTION_KEY)!==null);try{await repository?.flushCurrent();const listing=await listProjects();setRows(listing.projects);setDamagedCount(listing.damagedCount);}catch(error){setError(String(error));}finally{setBusy(false);}}
  async function switchProject(id:string,next:VnScript){const before=script;setBusy(true);setError("");try{const validated=parseScript(next);await repository?.flushCurrent();const target=rows.some(row=>row.id===id)?await projectRepository.open(id):await projectRepository.create(id,validated);if(latest.current!==before)throw new Error("대기 중 원고가 변경되어 작품 전환을 중단했습니다.");onSwitch(target);setOpen(false);setTitle("");}catch(error){setError(String(error));}finally{setBusy(false);}}
  function duplicateProject(source:VnScript){const {nativeSaveId,...copy}=source;void switchProject(crypto.randomUUID(),{...copy,title:`${source.title} · 복사`});}
  async function restore(file:File){const before=script;setBusy(true);setError("");try{const next=await restoreProjectBundle(file);if(latest.current!==before)throw new Error("복원 중 원고가 변경되어 전환을 중단했습니다.");await switchProject(crypto.randomUUID(),next);}catch(error){setError(String(error));}finally{setBusy(false);}}
  async function backupAuthoring(){
    if(!repository)return;setBusy(true);setError("");
    try{
      await repository.flushCurrent();
      const snapshot=repository.snapshot,receipts=await listProposalDecisions(snapshot.head.projectId);
      downloadBlob(await buildAuthoringArchive({script:snapshot.script,productionDocument:snapshot.productionDocument,sourceHead:snapshot.head,receipts:receipts.map(row=>row.receipt)}),`${snapshot.script.title.replace(/[<>:"/\\|?*]/g,"-")}-authoring.zip`);
      setFolderStatus("제작 아카이브를 내보냈습니다. 게임 ZIP과 다른 복원 항목입니다.");
    }catch(error){setError(`제작 아카이브 백업 실패: ${error instanceof Error?error.message:String(error)}`);}
    finally{setBusy(false);}
  }
  async function restoreAuthoring(file:File){
    const before=script;setBusy(true);setError("");
    try{
      const payload=await restoreAuthoringArchive(file);
      if(latest.current!==before)throw new Error("복원 중 원고가 변경되어 전환을 중단했습니다.");
      await repository?.flushCurrent();
      const target=await projectRepository.create(crypto.randomUUID(),payload.script);
      target.stage(payload.script,payload.productionDocument);
      const snapshot=await target.flushCurrent();
      if(latest.current!==before)throw new Error("복원 중 원고가 변경되어 전환을 중단했습니다.");
      emitAuthoringRestored({sourceHead:payload.sourceHead,restoredHead:snapshot.head,archiveHash:payload.archiveHash,importedDraft:payload.candidateSnapshot,receiptAuthority:"reference",autoResume:false});
      onSwitch(target);setOpen(false);setTitle("");
    }catch(error){setError(`제작 아카이브 복원 실패: ${error instanceof Error?error.message:String(error)}`);}
    finally{setBusy(false);}
  }
  function downloadLegacy(){
    const raw=localStorage.getItem(PRODUCTION_KEY);
    if(raw===null){setError("내려받을 이전 제작 체크포인트가 없습니다.");return;}
    downloadBlob(new Blob([raw],{type:"application/json;charset=utf-8"}),"vnmaker-legacy-checkpoint.json");
    setLegacyDownloaded(true);
  }
  async function importLegacy(){
    if(!repository||!legacyDownloaded||!legacyConfirmed)return;
    const raw=localStorage.getItem(PRODUCTION_KEY);if(raw===null){setError("이전 체크포인트 원문이 없습니다.");return;}
    const before=script;setBusy(true);setError("");
    try{
      const document=productionDocumentFromLegacy(parseLegacyProductionCheckpoint(JSON.parse(raw)));
      await repository.flushCurrent();repository.stage(repository.current.script,document);await repository.flushCurrent();
      if(latest.current!==before)throw new Error("가져오는 중 원고가 변경되어 전환을 중단했습니다.");
      setFolderStatus("확인한 작품에 이전 제작 계획을 가져왔습니다. 옛 작업은 재개하지 않습니다.");
    }catch(error){setError(`이전 체크포인트 가져오기 실패: ${error instanceof Error?error.message:String(error)}`);}
    finally{setBusy(false);}
  }
  return <><button className="studio-button" type="button" data-testid="project-library" onClick={()=>void show()}><Icon name="file"/>내 작품</button>
    {createPortal(<dialog ref={dialog} className="studio-modal project-library" aria-label="내 작품 보관함" onCancel={event=>{if(busy)event.preventDefault();else setOpen(false);}}><header><div><p className="eyebrow">PROJECT LIBRARY</p><h2>당신의 다음 이야기</h2></div><button aria-label="작품 보관함 닫기" disabled={busy} onClick={()=>setOpen(false)}>×</button></header><p>각 작품의 원고와 원화를 별도로 관리합니다. 전환하기 전 현재 원고를 보관합니다.</p>
      <form className="version-create" onSubmit={event=>{event.preventDefault();try{const next=newProject(title);void switchProject(crypto.randomUUID(),next);}catch(error){setError(String(error));}}}><input aria-label="새 작품 이름" value={title} onChange={event=>setTitle(event.target.value)} placeholder="새 작품의 제목" required disabled={busy}/><button className="studio-button primary" data-testid="project-create" disabled={busy}>빈 작품 만들기</button></form>
      <label className="project-restore">게임 ZIP에서 작품 복원<input type="file" accept=".zip,application/zip" aria-label="게임 ZIP에서 작품 복원" data-testid="project-restore-file" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void restore(file);}}/><small>원고와 가져온 원화를 새 작품으로 복원합니다. 기존 작품은 유지됩니다. 최대 512MB.</small></label>
      <section className="project-folder" aria-label="제작 아카이브"><strong>제작 메타데이터 아카이브</strong><p>원고·제작 문서·자산 목록·영수증 기록을 게임 ZIP과 별도로 보관합니다. 복원하면 새 작품/lineage가 되며 옛 제안은 적용되지 않습니다.</p><div><button className="studio-button" data-testid="authoring-archive-backup" disabled={busy||!repository} onClick={()=>void backupAuthoring()}>제작 아카이브 백업</button></div><label className="project-restore">제작 아카이브에서 복원<input type="file" accept=".zip,application/zip" aria-label="제작 아카이브에서 복원" data-testid="authoring-archive-restore" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void restoreAuthoring(file);}}/></label></section>
      {legacyPresent&&<section className="project-folder" aria-label="이전 제작 체크포인트"><strong>이전 전역 제작 체크포인트</strong><p>다른 작품의 옛 체크포인트는 원문을 받은 뒤 대상 작품을 확인해야만 가져올 수 있습니다. 자동으로 덮어쓰거나 재개하지 않습니다.</p><div><button className="studio-button" data-testid="legacy-checkpoint-download" disabled={busy} onClick={downloadLegacy}>이전 체크포인트 원문 받기</button><label><input type="checkbox" data-testid="legacy-checkpoint-confirm" checked={legacyConfirmed} disabled={busy||!legacyDownloaded} onChange={event=>setLegacyConfirmed(event.target.checked)}/>현재 작품을 대상으로 확인</label><button className="studio-button" data-testid="legacy-checkpoint-import" disabled={busy||!legacyDownloaded||!legacyConfirmed||!repository} onClick={()=>void importLegacy()}>확인한 작품에 가져오기</button></div></section>}
      <section className="project-folder" aria-label="폴더 백업"><strong>원본을 폴더로 보관</strong><p>압축 없이 한 파일씩 저장합니다. 선택한 위치에 새 백업 폴더를 만들며, 가져올 때는 그 폴더를 선택하세요. 다시 편집하려면 브라우저 저장 공간이 필요합니다.</p><div><button className="studio-button" disabled={busy||!folderPickerSupported()} onClick={()=>void folderAction("save")}>폴더에 백업</button><button className="studio-button" disabled={busy||!folderPickerSupported()} onClick={()=>void folderAction("open")}>폴더에서 가져오기</button></div>{!folderPickerSupported()&&<small>폴더 선택을 지원하는 Chrome 또는 Edge에서 사용할 수 있습니다.</small>}{folderStatus&&<p role="status">{folderStatus}</p>}</section>
      {damagedCount>0&&<p role="alert">읽을 수 없는 작품 {damagedCount}개를 목록에서 제외했습니다. 원본 데이터는 보관함에 유지됩니다. 정상 작품은 계속 열 수 있습니다.</p>}{damagedCount>0&&<LibraryArchiveButton disabled={busy}/>}{error&&<p role="alert">{error}</p>}<div className="version-list">{rows.map(row=><article key={row.id}><div><strong>{row.script.title}</strong><small>{row.script.scenes.length}개 장면 · {row.script.characters.length}명 · {new Date(row.updatedAt).toLocaleString("ko-KR")}{row.id===activeId?" · 현재 작품":""}</small></div><button className="studio-button" disabled={busy||row.id===activeId} onClick={()=>void switchProject(row.id,row.script)}>열기</button><button className="studio-button" disabled={busy} onClick={()=>duplicateProject(row.script)}>복제</button></article>)}</div>
    </dialog>,document.body)}</>;
}
