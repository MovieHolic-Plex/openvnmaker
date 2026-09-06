import { initializeEdition, EDITION, EDITION_KEY } from "./storage/edition.js";
import { ensureAssetServer } from "./storage/projectAssets.js";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./StudioApp.js";
import { EDITOR_LOCK, EditorSession } from "./studio/EditorSession.js";
import { LibraryRecovery } from "./studio/LibraryRecovery.js";
import { ACTIVE_PROJECT_KEY, listProjects, readSavedProject, projectRepository } from "./studio/projects.js";
import type {ProjectRepository} from "./studio/projectRepository.js";
import { PROJECT_KEY, loadProject } from "./studio/project.js";
import { parseScript } from "@vnmaker/content";
import {canonicalHash} from "@vnmaker/harness";
import "./styles/global.css";
import "./styles/studio.css";
import "./styles/studio-modern.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root 가 없다");
const root = createRoot(host);
if (!navigator.locks) {
  root.render(<EditorSession error="이 환경은 탭 사이의 저장 권한 잠금을 지원하지 않습니다. 저장 충돌을 방지하기 위해 편집기를 열지 않았습니다." />);
} else {
  root.render(<EditorSession />);
  // Do not initialize migrations, read the manuscript or mount autosave until we own the lock.
  void navigator.locks.request(EDITOR_LOCK, async () => {
    let recoveryInitial:ReturnType<typeof loadProject>|undefined;
    let recoveryId:string|undefined;
    if(localStorage.getItem(PROJECT_KEY)===null){
      // localStorage may not have reached disk when the browser process crashed.
      // Check durable manuscripts before first-run migration can create and autosave a sample.
      const listing=await listProjects();
      const rows=listing.projects;
      if(!rows.length && listing.damagedCount){
        root.render(<LibraryRecovery count={listing.damagedCount} onRestored={()=>{
          void ensureAssetServer().catch(()=>{});
          root.render(<StudioApp initialRepository={projectRepository.current()} />);
        }} />);
        // Recovery imports are writes too: retain ownership until document close/reload.
        await new Promise<void>(()=>{});
        return;
      }
      if(rows.length){
        const active=localStorage.getItem(ACTIVE_PROJECT_KEY);
        const candidate=rows.find(row=>row.id===active)??rows[0]!;
        const script=parseScript(candidate.script);
        recoveryId=candidate.id;
        localStorage.setItem(EDITION_KEY,EDITION);
        recoveryInitial={script,error:"빠른 복구 데이터가 없어 작품 보관함의 원고를 찾았습니다. 활성 작품 정보도 없으면 최근 저장 작품을 제시합니다. 제목과 저장 시점을 확인하고 복구하세요."};
      }
    }
    if(!recoveryInitial&&localStorage.getItem(PROJECT_KEY)===null)initializeEdition();
    const initial=recoveryInitial??loadProject();
    let repository:ProjectRepository|null=null;
    if(!initial.error){
      const id=localStorage.getItem(ACTIVE_PROJECT_KEY)||"original-project";
      try{
        const saved=await readSavedProject(id);
        const loaded=saved?await projectRepository.open(id):await projectRepository.create(id,initial.script);
        if(await canonicalHash(initial.script)!==loaded.snapshot.head.scriptHash){
          initial.script=loaded.snapshot.script;
          initial.error="빠른 복구 원고와 보관함의 저장본이 다릅니다. 보관함 저장본을 화면에 표시했습니다. 복구 원문도 유지했으니 원문을 백업하거나 보관함 원고로 복구하세요.";
        }else{repository=loaded;initial.script=loaded.snapshot.script;projectRepository.activate(loaded);}
      }catch(error){initial.error=error instanceof Error?error.message:String(error);}
    }
    void ensureAssetServer().catch(()=>{/* Import controls report storage availability. */});
    root.render(<StudioApp recoveryInitial={initial} initialRepository={repository} {...(recoveryId?{initialProjectId:recoveryId}:{})} />);
    // The browser releases this document's lock on close/reload/crash. Never steal another writer's lock.
    await new Promise<void>(()=>{});
  }).catch(() => root.render(<EditorSession error="편집 권한 확보 또는 초기화에 실패했습니다. 현재 탭을 새로고침해 다시 시도하세요." />));
}
