import {LibraryArchiveButton} from "./LibraryArchiveButton.js";
import {createPortal} from "react-dom";
import {useEffect,useRef,useState} from "react";
import {parseScript,type VnScript} from "@vnmaker/content";
import {deleteProject,listProjects,newProject,restoreLibraryArchive,saveProject,stripSharedNativeSaveId,type SavedProject} from "./projects.js";
import {Icon} from "./Icon.js";
import {restoreProjectBundle} from "./restoreBundle.js";
import {isLibraryArchive} from "./libraryArchive.js";
import {folderPickerSupported,openProjectFolder,pickProjectFolder,saveProjectFolder,type FolderProgress} from "./projectFolder.js";
import {deleteProjectVersions} from "./versions.js";
import {removeUnreferencedAssets} from "./assetCleanup.js";
import {collectProjectAssets} from "./exportBundle.js";
import {StorageUsage} from "./StorageUsage.js";
const MAX_JSON=64*1024*1024;
export function ProjectLibrary({script,activeId,onSwitch}:{script:VnScript;activeId:string;onSwitch:(id:string,script:VnScript)=>void}){
  const[open,setOpen]=useState(false),[rows,setRows]=useState<SavedProject[]>([]),[busy,setBusy]=useState(false),[title,setTitle]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [damagedCount,setDamagedCount]=useState(0),[confirming,setConfirming]=useState<string|null>(null),[storageEpoch,setStorageEpoch]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),latest=useRef(script);latest.current=script;
  const[folderStatus,setFolderStatus]=useState("");
  const progress=({phase,complete,total}:FolderProgress)=>setFolderStatus(`${phase==="save"?"폴더에 저장":phase==="check"?"원본 확인":"작품 가져오기"} · ${complete} / ${total}`);
  async function folderAction(action:"save"|"open"){
    const before=script;setBusy(true);setError("");setFolderStatus("");
    try{
      const directory=await pickProjectFolder(action==="save"?"readwrite":"read");
      if(action==="save"){const name=await saveProjectFolder(directory,before,progress);setFolderStatus(`저장 완료 · ${name}`);}
      else{const next=await openProjectFolder(directory,progress);if(latest.current!==before){await removeUnreferencedAssets(collectProjectAssets(next).filter(path=>path.startsWith("/assets/user/")),{id:activeId,script:latest.current}).catch(()=>({removed:[],kept:[]}));throw new Error("가져오는 중 원고가 변경되어 전환을 중단했습니다.");}const folderOthers=(await listProjects()).projects.map(row=>row.script);const {script:folderNext,stripped:folderStripped}=stripSharedNativeSaveId(next,[...folderOthers,before]);if(folderStripped)setNotice("같은 네이티브 배포 ID를 쓰는 작품이 이미 있어 가져온 작품의 배포 ID를 비웠습니다. 기존 작품의 세이브 폴더와 섞이지 않습니다.");await switchProject(crypto.randomUUID(),folderNext);setFolderStatus("");}
    }catch(error){setFolderStatus("");if(!(error instanceof DOMException&&error.name==="AbortError"))setError(`폴더 작업 실패: ${error instanceof Error?error.message:String(error)}`);}
    finally{setBusy(false);}
  }
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  async function refresh(){const listing=await listProjects();setRows(listing.projects);setDamagedCount(listing.damagedCount);return listing;}
  async function show(){setOpen(true);setBusy(true);setError("");setConfirming(null);try{await saveProject(activeId,script);await refresh();}catch(error){setError(String(error));}finally{setBusy(false);}}
  async function switchProject(id:string,next:VnScript){const before=script;setBusy(true);setError("");try{const validated=parseScript(next);await saveProject(activeId,before);await saveProject(id,validated);if(latest.current!==before)throw new Error("대기 중 원고가 변경되어 작품 전환을 중단했습니다.");onSwitch(id,validated);setOpen(false);setTitle("");}catch(error){setError(String(error));}finally{setBusy(false);}}
  function duplicateProject(source:VnScript){const {nativeSaveId,...copy}=source;void switchProject(crypto.randomUUID(),{...copy,title:`${source.title} · 복사`});}
  async function restore(file:File){
    const before=script;setBusy(true);setError("");setNotice("");
    try{
      if(file.name.toLowerCase().endsWith(".json")){
        if(!file.size||file.size>MAX_JSON)throw new Error("JSON은 64MB 이하로 가져올 수 있습니다.");
        const text=await file.text();let value:unknown;try{value=JSON.parse(text);}catch{throw new Error("JSON을 읽지 못했습니다.");}
        if(latest.current!==before)throw new Error("복원 중 원고가 변경되어 전환을 중단했습니다.");
        if(isLibraryArchive(value)){
          // 보관함 원본: 모든 정상 기록을 새 작품으로 들여오고 가장 최근 것으로 전환한다.
          const result=await restoreLibraryArchive(text);
          setNotice(`보관함 원본에서 작품 ${result.restored.length}개를 들여왔습니다.${result.skipped?` 읽을 수 없는 기록 ${result.skipped}개는 건너뛰었습니다.`:""}${result.stripped?` 배포 ID가 겹치는 원고 ${result.stripped}개는 ID를 비웠습니다.`:""}`);
          const latestRow=result.restored[0]!;await switchProject(latestRow.id,latestRow.script);return;
        }
        const parsed=parseScript(value);
        if(latest.current!==before)throw new Error("복원 중 원고가 변경되어 전환을 중단했습니다.");
        const jsonOthers=(await listProjects()).projects.map(row=>row.script);
        const {script:jsonNext,stripped:jsonStripped}=stripSharedNativeSaveId(parsed,[...jsonOthers,before]);
        if(jsonStripped)setNotice("같은 네이티브 배포 ID를 쓰는 작품이 이미 있어 복원본의 배포 ID를 비웠습니다. 기존 작품의 세이브 폴더와 섞이지 않습니다.");
        await switchProject(crypto.randomUUID(),jsonNext);return;
      }
      const restored=await restoreProjectBundle(file);
      if(latest.current!==before){
        // 번들 복원이 먼저 IndexedDB 에 블롭을 커밋한다 — 전환을 멈추면 아무도 참조하지 않는 파일만 지운다.
        await removeUnreferencedAssets(collectProjectAssets(restored).filter(path=>path.startsWith("/assets/user/")),{id:activeId,script:latest.current}).catch(()=>({removed:[],kept:[]}));
        throw new Error("복원 중 원고가 변경되어 전환을 중단했습니다.");
      }
      const others=(await listProjects()).projects.map(row=>row.script);
      const {script:next,stripped}=stripSharedNativeSaveId(restored,[...others,before]);
      if(stripped)setNotice("같은 네이티브 배포 ID를 쓰는 작품이 이미 있어 복원본의 배포 ID를 비웠습니다. 기존 작품의 세이브 폴더와 섞이지 않습니다.");
      await switchProject(crypto.randomUUID(),next);
    }catch(error){setError(String(error));}finally{setBusy(false);}
  }
  /** 활성 작품은 지우지 않는다(먼저 다른 작품을 열어야 한다). 버전 기록과 이제 아무도 쓰지 않는 보관함 파일도 함께 정리한다. */
  async function remove(row:SavedProject){
    if(row.id===activeId)return;
    setBusy(true);setError("");setNotice("");
    try{
      await deleteProject(row.id);
      const versions=await deleteProjectVersions(row.id).catch(()=>0);
      const cleanup=await removeUnreferencedAssets(collectProjectAssets(row.script),{id:activeId,script:latest.current}).catch(()=>({removed:[] as string[],kept:[] as string[]}));
      setNotice(`‘${row.script.title}’을(를) 삭제했습니다.${versions?` 버전 기록 ${versions}개`:""}${cleanup.removed.length?`${versions?",":""} 보관함 파일 ${cleanup.removed.length}개`:""}${versions||cleanup.removed.length?"를 함께 정리했습니다.":""}`);
      setStorageEpoch(value=>value+1);
      await refresh();
    }catch(error){setError(String(error));}
    finally{setConfirming(null);setBusy(false);}
  }
  return <><button className="studio-button" type="button" data-testid="project-library" onClick={()=>void show()}><Icon name="file"/>내 작품</button>
    {createPortal(<dialog ref={dialog} className="studio-modal project-library" aria-label="내 작품 보관함" onCancel={event=>{if(busy)event.preventDefault();else setOpen(false);}}><header><div><p className="eyebrow">PROJECT LIBRARY</p><h2>당신의 다음 이야기</h2></div><button aria-label="작품 보관함 닫기" disabled={busy} onClick={()=>setOpen(false)}>×</button></header><p>각 작품의 원고와 원화를 별도로 관리합니다. 전환하기 전 현재 원고를 보관합니다.</p>
      <StorageUsage refreshKey={storageEpoch}/>
      <form className="version-create" onSubmit={event=>{event.preventDefault();try{const next=newProject(title);void switchProject(crypto.randomUUID(),next);}catch(error){setError(String(error));}}}><input aria-label="새 작품 이름" value={title} onChange={event=>setTitle(event.target.value)} placeholder="새 작품의 제목" required disabled={busy}/><button className="studio-button primary" data-testid="project-create" disabled={busy}>빈 작품 만들기</button></form>
      <label className="project-restore">게임 ZIP·백업 JSON에서 작품 복원<input type="file" accept=".zip,.json,application/zip,application/json" aria-label="게임 ZIP에서 작품 복원" data-testid="project-restore-file" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void restore(file);}}/><small>게임 ZIP은 원고와 가져온 원화를, 원고 JSON은 원고를 새 작품으로 복원합니다. 「보관함 원본 JSON」은 모든 정상 기록을 들여옵니다. 기존 작품은 유지됩니다. ZIP 최대 512MB · JSON 최대 64MB.</small></label>
      <section className="project-folder" aria-label="폴더 백업"><strong>원본을 폴더로 보관</strong><p>압축 없이 한 파일씩 저장합니다. 선택한 위치에 새 백업 폴더를 만들며, 가져올 때는 그 폴더를 선택하세요. 다시 편집하려면 브라우저 저장 공간이 필요합니다.</p><div><button className="studio-button" disabled={busy||!folderPickerSupported()} onClick={()=>void folderAction("save")}>폴더에 백업</button><button className="studio-button" disabled={busy||!folderPickerSupported()} onClick={()=>void folderAction("open")}>폴더에서 가져오기</button></div>{!folderPickerSupported()&&<small>폴더 선택을 지원하는 Chrome 또는 Edge에서 사용할 수 있습니다.</small>}{folderStatus&&<p role="status">{folderStatus}</p>}</section>
      {damagedCount>0&&<p role="alert">읽을 수 없는 작품 {damagedCount}개를 목록에서 제외했습니다. 원본 데이터는 보관함에 유지됩니다. 정상 작품은 계속 열 수 있습니다.</p>}{damagedCount>0&&<LibraryArchiveButton disabled={busy}/>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status" data-testid="project-library-notice">{notice}</p>}<div className="version-list">{rows.map(row=><article key={row.id} data-testid={`project-row-${row.id}`}><div><strong>{row.script.title}</strong><small>{row.script.scenes.length}개 장면 · {row.script.characters.length}명 · {new Date(row.updatedAt).toLocaleString("ko-KR")}{row.id===activeId?" · 현재 작품":""}</small></div>{confirming===row.id?<><button className="studio-button danger" disabled={busy} aria-label={`${row.script.title} 삭제 확정`} onClick={()=>void remove(row)}>정말 삭제</button><button className="studio-button" disabled={busy} onClick={()=>setConfirming(null)}>취소</button></>:<><button className="studio-button" disabled={busy||row.id===activeId} onClick={()=>void switchProject(row.id,row.script)}>열기</button><button className="studio-button" disabled={busy} onClick={()=>duplicateProject(row.script)}>복제</button><button className="studio-button" disabled={busy||row.id===activeId} aria-label={`${row.script.title} 삭제`} title={row.id===activeId?"현재 작품은 다른 작품을 연 뒤 삭제할 수 있습니다.":"이 작품과 버전 기록을 삭제합니다."} onClick={()=>setConfirming(row.id)}>삭제</button></>}</article>)}</div>
    </dialog>,document.body)}</>;
}
