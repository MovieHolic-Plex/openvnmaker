import {LibraryArchiveButton} from "./LibraryArchiveButton.js";
import {createPortal} from "react-dom";
import {useEffect,useRef,useState} from "react";
import {parseScript,type VnScript} from "@vnmaker/content";
import {listProjects,newProject,type SavedProject} from "./projects.js";
import {projectRepository,type ProjectRepository} from "./projectRepository.js";
import {Icon} from "./Icon.js";
import {restoreProjectBundle} from "./restoreBundle.js";
import {folderPickerSupported,openProjectFolder,pickProjectFolder,saveProjectFolder,type FolderProgress} from "./projectFolder.js";
export function ProjectLibrary({script,activeId,repository,onSwitch}:{script:VnScript;activeId:string;repository:ProjectRepository|null;onSwitch:(repository:ProjectRepository)=>void}){
  const[open,setOpen]=useState(false),[rows,setRows]=useState<SavedProject[]>([]),[busy,setBusy]=useState(false),[title,setTitle]=useState(""),[error,setError]=useState("");
  const [damagedCount,setDamagedCount]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),latest=useRef(script);latest.current=script;
  const[folderStatus,setFolderStatus]=useState("");
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
  async function show(){setOpen(true);setBusy(true);setError("");try{await repository?.flushCurrent();const listing=await listProjects();setRows(listing.projects);setDamagedCount(listing.damagedCount);}catch(error){setError(String(error));}finally{setBusy(false);}}
  async function switchProject(id:string,next:VnScript){const before=script;setBusy(true);setError("");try{const validated=parseScript(next);await repository?.flushCurrent();const target=rows.some(row=>row.id===id)?await projectRepository.open(id):await projectRepository.create(id,validated);if(latest.current!==before)throw new Error("대기 중 원고가 변경되어 작품 전환을 중단했습니다.");onSwitch(target);setOpen(false);setTitle("");}catch(error){setError(String(error));}finally{setBusy(false);}}
  function duplicateProject(source:VnScript){const {nativeSaveId,...copy}=source;void switchProject(crypto.randomUUID(),{...copy,title:`${source.title} · 복사`});}
  async function restore(file:File){const before=script;setBusy(true);setError("");try{const next=await restoreProjectBundle(file);if(latest.current!==before)throw new Error("복원 중 원고가 변경되어 전환을 중단했습니다.");await switchProject(crypto.randomUUID(),next);}catch(error){setError(String(error));}finally{setBusy(false);}}
  return <><button className="studio-button" type="button" data-testid="project-library" onClick={()=>void show()}><Icon name="file"/>내 작품</button>
    {createPortal(<dialog ref={dialog} className="studio-modal project-library" aria-label="내 작품 보관함" onCancel={event=>{if(busy)event.preventDefault();else setOpen(false);}}><header><div><p className="eyebrow">PROJECT LIBRARY</p><h2>당신의 다음 이야기</h2></div><button aria-label="작품 보관함 닫기" disabled={busy} onClick={()=>setOpen(false)}>×</button></header><p>각 작품의 원고와 원화를 별도로 관리합니다. 전환하기 전 현재 원고를 보관합니다.</p>
      <form className="version-create" onSubmit={event=>{event.preventDefault();try{const next=newProject(title);void switchProject(crypto.randomUUID(),next);}catch(error){setError(String(error));}}}><input aria-label="새 작품 이름" value={title} onChange={event=>setTitle(event.target.value)} placeholder="새 작품의 제목" required disabled={busy}/><button className="studio-button primary" data-testid="project-create" disabled={busy}>빈 작품 만들기</button></form>
      <label className="project-restore">게임 ZIP에서 작품 복원<input type="file" accept=".zip,application/zip" aria-label="게임 ZIP에서 작품 복원" data-testid="project-restore-file" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void restore(file);}}/><small>원고와 가져온 원화를 새 작품으로 복원합니다. 기존 작품은 유지됩니다. 최대 512MB.</small></label>
      <section className="project-folder" aria-label="폴더 백업"><strong>원본을 폴더로 보관</strong><p>압축 없이 한 파일씩 저장합니다. 선택한 위치에 새 백업 폴더를 만들며, 가져올 때는 그 폴더를 선택하세요. 다시 편집하려면 브라우저 저장 공간이 필요합니다.</p><div><button className="studio-button" disabled={busy||!folderPickerSupported()} onClick={()=>void folderAction("save")}>폴더에 백업</button><button className="studio-button" disabled={busy||!folderPickerSupported()} onClick={()=>void folderAction("open")}>폴더에서 가져오기</button></div>{!folderPickerSupported()&&<small>폴더 선택을 지원하는 Chrome 또는 Edge에서 사용할 수 있습니다.</small>}{folderStatus&&<p role="status">{folderStatus}</p>}</section>
      {damagedCount>0&&<p role="alert">읽을 수 없는 작품 {damagedCount}개를 목록에서 제외했습니다. 원본 데이터는 보관함에 유지됩니다. 정상 작품은 계속 열 수 있습니다.</p>}{damagedCount>0&&<LibraryArchiveButton disabled={busy}/>}{error&&<p role="alert">{error}</p>}<div className="version-list">{rows.map(row=><article key={row.id}><div><strong>{row.script.title}</strong><small>{row.script.scenes.length}개 장면 · {row.script.characters.length}명 · {new Date(row.updatedAt).toLocaleString("ko-KR")}{row.id===activeId?" · 현재 작품":""}</small></div><button className="studio-button" disabled={busy||row.id===activeId} onClick={()=>void switchProject(row.id,row.script)}>열기</button><button className="studio-button" disabled={busy} onClick={()=>duplicateProject(row.script)}>복제</button></article>)}</div>
    </dialog>,document.body)}</>;
}
