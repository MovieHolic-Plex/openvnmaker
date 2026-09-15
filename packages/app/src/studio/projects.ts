import {withNarrativeIds} from "./narrativeIds.js";
import {parseLibraryArchive,serializeLibraryArchive} from "./libraryArchive.js";
import {parseScript,type VnScript} from "@vnmaker/content";
import {PROJECT_KEY,clearQuickRecovery,loadProject,readQuickRecoveryMeta,writeQuickRecovery} from "./project.js";
import {initializeEdition,EDITION,EDITION_KEY} from "../storage/edition.js";
import {manuscriptKey} from "../storage/manuscriptKey.js";
export const ACTIVE_PROJECT_KEY="vnmaker.studio.active-project.v1";
export const DEFAULT_PROJECT_ID="original-project";
export interface SavedProject {id:string;script:VnScript;updatedAt:number}
export function readActiveProjectId():string{try{return localStorage.getItem(ACTIVE_PROJECT_KEY)||DEFAULT_PROJECT_ID;}catch{return DEFAULT_PROJECT_ID;}}
/**
 * 활성 작품을 바꾼다. 호출 전에 보관함(IndexedDB) 저장이 끝나 있어야 한다.
 * 활성 id 를 먼저 쓰고 원고 사본은 나중에 쓴다 — 사본 쓰기가 용량 초과로 실패하면 사본을 비운다.
 * 이전에는 사본을 새 원고로 바꾼 뒤 id 쓰기가 실패하면 되돌리기가 다시 실패할 수 있어, 다음 실행이
 * 이전 작품 id 아래에서 새 원고를 열고 이전 작품의 보관함 기록을 덮어썼다.
 * 사본이 없으면 다음 실행은 보관함에서 활성 작품을 읽는다(resolveStartupProject).
 */
export function activateProject(id:string,script:VnScript,storage:Storage=localStorage):{quickRecovery:boolean} {
  try{storage.setItem(ACTIVE_PROJECT_KEY,id);}
  catch(error){
    // 다른 작품의 사본이 새 id 아래에서 열리면 그 작품을 덮어쓴다. 사본을 비워 공간을 만들고 한 번 더 시도한다.
    clearQuickRecovery(storage);
    try{storage.setItem(ACTIVE_PROJECT_KEY,id);}catch{throw new Error("활성 작품 정보를 저장하지 못했습니다. 브라우저 저장 공간을 비운 뒤 내 작품에서 다시 열어주세요. 원고는 작품 보관함에 있습니다.",{cause:error});}
  }
  try{writeQuickRecovery(script,storage);return {quickRecovery:true};}
  catch{clearQuickRecovery(storage);return {quickRecovery:false};}
}
export function newProject(title:string):VnScript {
  return withNarrativeIds(parseScript({title:title.trim(),subtitle:"",start:"start",characters:[],assets:[],assetLibraryMode:"project",flags:{},scenes:[{id:"start",chapter:"첫 번째 장면",background:"title",lines:[{speaker:null,text:"새로운 이야기가 시작됩니다."}],ending:"이야기의 끝"}]}));
}
/** 복원본이 이미 있는 작품과 같은 네이티브 배포 ID 를 가지면 비운다 — 두 작품이 한 저장 폴더를 나눠 쓰면 세이브가 섞인다. */
export function stripSharedNativeSaveId(script:VnScript,others:readonly VnScript[]):{script:VnScript;stripped:boolean} {
  if(!script.nativeSaveId||!others.some(other=>other.nativeSaveId===script.nativeSaveId))return {script,stripped:false};
  const {nativeSaveId:_shared,...rest}=script;
  return {script:rest,stripped:true};
}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open("vnmaker.projects",1);request.onupgradeneeded=()=>request.result.createObjectStore("projects",{keyPath:"id"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error("다른 탭의 작품 보관함을 닫고 다시 시도하세요."));});}
async function putProject(row:SavedProject):Promise<void>{
  const db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction("projects","readwrite",{durability:"strict"});tx.objectStore("projects").put(row);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(new Error("작품 보관함에 저장하지 못했습니다. 현재 작품을 JSON으로 백업하세요."));};});
}
export async function saveProject(id:string,script:VnScript):Promise<void>{
  parseScript(script);
  return putProject({id,script:structuredClone(script),updatedAt:Date.now()});
}
export async function deleteProject(id:string):Promise<void>{
  const db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction("projects","readwrite",{durability:"strict"});tx.objectStore("projects").delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(new Error("작품을 삭제하지 못했습니다. 보관함 기록은 그대로 남아 있습니다."));};});
}
function validatedProject(value:unknown):SavedProject {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("작품 보관함 기록이 손상되었습니다.");
  const row=value as Partial<SavedProject>;
  if(typeof row.id!=="string" || !row.id.trim() || typeof row.updatedAt!=="number" || !Number.isFinite(row.updatedAt) || Math.abs(row.updatedAt)>8640000000000000)throw new Error("작품 보관함 기록이 손상되었습니다.");
  return {id:row.id,updatedAt:row.updatedAt,script:parseScript(row.script)};
}
export async function readSavedProject(id:string):Promise<SavedProject|null>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("projects","readonly"),request=tx.objectStore("projects").get(id);
    request.onsuccess=()=>{try{const row=request.result as SavedProject|undefined;if(!row){resolve(null);return;}if(row.id!==id||!Number.isFinite(row.updatedAt))throw new Error("작품 보관함 기록이 손상되었습니다.");resolve(validatedProject(row));}catch(error){reject(error);}};
    request.onerror=()=>reject(request.error);tx.oncomplete=tx.onabort=()=>db.close();
  });
}
export interface ProjectListing {projects:SavedProject[];damagedCount:number}
/** Validate records independently. Invalid originals stay untouched in IndexedDB. */
export async function listProjects():Promise<ProjectListing>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("projects","readonly"),request=tx.objectStore("projects").getAll();
    let listing:ProjectListing={projects:[],damagedCount:0};
    request.onsuccess=()=>{
      for(const value of request.result){try{listing.projects.push(validatedProject(value));}catch{listing.damagedCount++;}}
      listing.projects.sort((a,b)=>b.updatedAt-a.updatedAt);
    };
    tx.oncomplete=()=>{db.close();resolve(listing);};
    tx.onabort=tx.onerror=()=>{db.close();reject(tx.error??new Error("작품 보관함을 읽지 못했습니다."));};
  });
}

/** Raw snapshot: never run the manuscript parser or mutate stored records. */
export async function readLibraryArchive():Promise<string>{
  const db=await database();
  const records=await new Promise<unknown[]>((resolve,reject)=>{
    const tx=db.transaction("projects","readonly"),request=tx.objectStore("projects").getAll();
    tx.oncomplete=()=>{db.close();resolve(request.result);};
    tx.onabort=tx.onerror=()=>{db.close();reject(tx.error??new Error("보관함 원본을 읽지 못했습니다."));};
  });
  return serializeLibraryArchive(records);
}
export interface ArchiveRestoreResult {restored:SavedProject[];skipped:number}
/**
 * 「보관함 원본 JSON」을 다시 들여온다. 읽을 수 있는 기록만 새 작품으로 저장하고, 기존 기록(손상 포함)은 절대 덮어쓰지 않는다.
 * 같은 id 가 이미 있으면 새 id 를 준다. 저장 시각은 원본 기록의 값을 유지한다.
 */
export async function restoreLibraryArchive(text:string):Promise<ArchiveRestoreResult>{
  const archive=parseLibraryArchive(text);
  const existing=new Set((await new Promise<string[]>(async(resolve,reject)=>{try{const db=await database();const tx=db.transaction("projects","readonly"),request=tx.objectStore("projects").getAllKeys();tx.oncomplete=()=>{db.close();resolve(request.result.map(String));};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error);};}catch(error){reject(error);}})));
  const restored:SavedProject[]=[];
  let skipped=0;
  for(const record of archive.records){
    let row:SavedProject;
    try{row=validatedProject(record);}catch{skipped++;continue;}
    const id=existing.has(row.id)?crypto.randomUUID():row.id;
    existing.add(id);
    const saved={id,script:structuredClone(row.script),updatedAt:row.updatedAt};
    await putProject(saved);
    restored.push(saved);
  }
  if(!restored.length)throw new Error(skipped?`보관함 원본의 기록 ${skipped}개를 모두 읽지 못했습니다.`:"보관함 원본에 작품 기록이 없습니다.");
  restored.sort((a,b)=>b.updatedAt-a.updatedAt);
  return {restored,skipped};
}

export type StartupProject={kind:"library-recovery";damagedCount:number}|{kind:"editor";initial:{script:VnScript;error:string|null}};
const when=(value:number)=>new Date(value).toLocaleString("ko-KR");
/**
 * 편집기를 열 때 어느 원고를 보여줄지 정한다. 잠금을 얻은 뒤 한 번 실행된다.
 *
 * 1. 빠른 복구 사본이 없으면 보관함에서 활성 작품을 찾는다(브라우저 크래시·사본 쓰기 실패 뒤).
 * 2. 사본이 있어도 보관함 기록이 확실히 더 새롭고 내용이 다르면 보관함을 연다. 사본 쓰기가 용량 초과로
 *    실패한 뒤 보관함만 갱신됐을 때 오래된 사본이 열려 첫 자동 저장이 보관함을 덮어쓰던 경로를 막는다.
 *    나이를 모르는 사본(메타 없음·불일치)은 예전처럼 사본이 이긴다.
 * 3. 어느 쪽이든 자동으로 저장하지 않고 안내를 띄운다 — 사용자가 확인하고 저장을 켠다.
 */
export async function resolveStartupProject():Promise<StartupProject>{
  let raw:string|null=null;
  try{raw=localStorage.getItem(PROJECT_KEY);}catch{/* 접근 불가 — 아래에서 보관함을 본다. */}
  if(raw===null){
    // localStorage may not have reached disk when the browser process crashed, or the copy was cleared after a quota failure.
    // Check durable manuscripts before first-run migration can create and autosave a sample.
    const listing=await listProjects();
    const rows=listing.projects;
    if(!rows.length && listing.damagedCount)return {kind:"library-recovery",damagedCount:listing.damagedCount};
    if(rows.length){
      // 활성 id 도 없으면 가장 최근에 저장한 작품을 제시한다(기본 id 로 추정하면 옛 샘플 작품이 앞서 나온다).
      let active:string|null=null;
      try{active=localStorage.getItem(ACTIVE_PROJECT_KEY);}catch{active=null;}
      const candidate=rows.find(row=>row.id===active)??rows[0]!;
      const script=parseScript(candidate.script);
      try{localStorage.setItem(ACTIVE_PROJECT_KEY,candidate.id);localStorage.setItem(EDITION_KEY,EDITION);}catch{/* 용량 초과 — 활성 id 는 다음 저장에서 다시 쓴다. */}
      return {kind:"editor",initial:{script,error:"빠른 복구 데이터가 없어 작품 보관함의 원고를 찾았습니다. 활성 작품 정보도 없으면 최근 저장 작품을 제시합니다. 제목과 저장 시점을 확인하고 복구하세요."}};
    }
    initializeEdition();
    return {kind:"editor",initial:loadProject()};
  }
  initializeEdition();
  const loaded=loadProject();
  if(loaded.error)return {kind:"editor",initial:loaded};
  let durable:SavedProject|null=null;
  try{durable=await readSavedProject(readActiveProjectId());}catch{durable=null;}
  if(!durable)return {kind:"editor",initial:loaded};
  let current:string|null=null;
  try{current=localStorage.getItem(PROJECT_KEY);}catch{current=null;}
  const meta=current===null?null:readQuickRecoveryMeta(current);
  if(meta && durable.updatedAt-meta.updatedAt>2000 && manuscriptKey(durable.script)!==manuscriptKey(loaded.script)){
    return {kind:"editor",initial:{script:durable.script,error:`빠른 복구 사본(${when(meta.updatedAt)})이 작품 보관함 원고(${when(durable.updatedAt)})보다 오래되었습니다. 보관함의 최신 원고를 열었습니다. 내용을 확인한 뒤 저장하세요. 오래된 사본은 복구 시 보존됩니다.`}};
  }
  return {kind:"editor",initial:loaded};
}
