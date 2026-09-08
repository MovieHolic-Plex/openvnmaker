import {withNarrativeIds} from "./narrativeIds.js";
import {serializeLibraryArchive} from "./libraryArchive.js";
import {parseScript,type VnScript} from "@vnmaker/content";
import {PROJECT_KEY} from "./project.js";
import {canonicalJson,parseProjectHead,type ProjectHead,type ProductionDocument} from "@vnmaker/harness";
import {projectRepository} from "./projectRepository.js";
export {projectRepository} from "./projectRepository.js";
export const ACTIVE_PROJECT_KEY="vnmaker.studio.active-project.v1";
export interface SavedProject {readonly id:string;readonly script:VnScript;readonly updatedAt:number}
export function activateProject(id:string,script:VnScript,preserveRecovery=false):void {
  const previousId=localStorage.getItem(ACTIVE_PROJECT_KEY),previousScript=localStorage.getItem(PROJECT_KEY);
  // Every recovery activation, including JSON/library imports, preserves the original before replacing its mirror.
  if(preserveRecovery&&previousScript!==null)localStorage.setItem(`vnmaker.recovery-preserved.${crypto.randomUUID()}`,previousScript);
  try{localStorage.setItem(PROJECT_KEY,JSON.stringify(script));localStorage.setItem(ACTIVE_PROJECT_KEY,id);}
  catch(error){
    try{if(previousScript===null)localStorage.removeItem(PROJECT_KEY);else localStorage.setItem(PROJECT_KEY,previousScript);if(previousId===null)localStorage.removeItem(ACTIVE_PROJECT_KEY);else localStorage.setItem(ACTIVE_PROJECT_KEY,previousId);}catch{/* Both manuscripts remain in the durable project library. */}
    throw new Error("활성 작품을 저장하지 못했습니다. 원고는 작품 보관함에 유지됩니다.",{cause:error});
  }
}
export function newProject(title:string):VnScript {
  return withNarrativeIds(parseScript({title:title.trim(),subtitle:"",start:"start",characters:[],assets:[],assetLibraryMode:"project",flags:{},scenes:[{id:"start",chapter:"첫 번째 장면",background:"title",lines:[{speaker:null,text:"새로운 이야기가 시작됩니다."}],ending:"이야기의 끝"}]}));
}
export class ProjectStorageError extends Error {
  override readonly name="ProjectStorageError";
  constructor(readonly code:"blocked"|"damaged"|"stale-head"|"missing"|"write",options?:ErrorOptions){super(`작품 보관함: ${code}. 원본은 유지됩니다. 다른 탭을 닫거나 백업 후 다시 시도하세요.`,options);}
}
export function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  let blocked=false;
  const request=indexedDB.open("vnmaker.projects",2);
  request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains("projects"))db.createObjectStore("projects",{keyPath:"id"});
    db.createObjectStore("project-heads",{keyPath:"projectId"});
    db.createObjectStore("production-documents",{keyPath:"projectId"});
    db.createObjectStore("proposal-decisions",{keyPath:["projectId","lineageId","proposalId"]});
  };
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();if(blocked)db.close();else resolve(db);};
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>{blocked=true;reject(new ProjectStorageError("blocked"));};
});}
/** New identities only. Existing editor writes must use their originating repository. */
export async function saveProject(id:string,script:VnScript):Promise<void>{
  await projectRepository.create(id,script);
}
export function validatedProject(value:unknown):SavedProject {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("작품 보관함 기록이 손상되었습니다.");
  const row=value;
  if(!("id" in row)||!("updatedAt" in row)||!("script" in row))throw new ProjectStorageError("damaged");
  if(typeof row.id!=="string" || !row.id.trim() || typeof row.updatedAt!=="number" || !Number.isFinite(row.updatedAt) || Math.abs(row.updatedAt)>8640000000000000)throw new Error("작품 보관함 기록이 손상되었습니다.");
  return {id:row.id,updatedAt:row.updatedAt,script:parseScript(row.script)};
}
export async function readSavedProject(id:string):Promise<SavedProject|null>{
  const stored=await readStoredProject(id);
  if(stored.record===undefined)return null;
  const repository=await projectRepository.open(id);
  return {id,script:repository.snapshot.script,updatedAt:validatedProject(stored.record).updatedAt};
}
export type StoredProject={readonly record:unknown;readonly head:unknown;readonly production:unknown};
export async function readStoredProject(id:string):Promise<StoredProject>{
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(["projects","project-heads","production-documents"]);
    const record=tx.objectStore("projects").get(id),head=tx.objectStore("project-heads").get(id),production=tx.objectStore("production-documents").get(id);
    tx.oncomplete=()=>resolve({record:record.result,head:head.result,production:production.result});
    tx.onabort=()=>reject(new ProjectStorageError("damaged",{cause:tx.error}));
  });}finally{db.close();}
}
export function sameHead(left:ProjectHead,right:ProjectHead):boolean{return canonicalJson(left)===canonicalJson(right);}
export type StoredCommit={
  readonly record:SavedProject;readonly head:ProjectHead;readonly productionDocument:ProductionDocument;
  readonly expectedHead:ProjectHead|null;readonly expectedRecord:unknown;readonly metadataOnly:boolean;
};
/** Hashing/validation happens before this call. Only IDB requests run inside the transaction. */
export async function commitStoredProject(commit:StoredCommit,checkGeneration:()=>void,signal?:AbortSignal):Promise<void>{
  const db=await database();
  try{
    checkGeneration();
    signal?.throwIfAborted();
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(["projects","project-heads","production-documents"],"readwrite",{durability:"strict"});
      let failure:unknown;
      const abort=()=>{failure=signal?.reason;tx.abort();};
      signal?.addEventListener("abort",abort,{once:true});
      const record=tx.objectStore("projects").get(commit.record.id),head=tx.objectStore("project-heads").get(commit.record.id);
      head.onsuccess=()=>{try{
        checkGeneration();
        if(commit.expectedHead===null){
          if(head.result!==undefined || canonicalJson(record.result??null)!==canonicalJson(commit.expectedRecord??null))throw new ProjectStorageError("stale-head");
        }else if(head.result===undefined||!sameHead(parseProjectHead(head.result),commit.expectedHead))throw new ProjectStorageError("stale-head");
        if(!commit.metadataOnly)tx.objectStore("projects").put(commit.record);
        tx.objectStore("project-heads").put(commit.head);
        tx.objectStore("production-documents").put({projectId:commit.head.projectId,document:commit.productionDocument});
      }catch(error){failure=error;tx.abort();}};
      tx.oncomplete=()=>{signal?.removeEventListener("abort",abort);resolve();};
      tx.onabort=()=>{signal?.removeEventListener("abort",abort);reject(failure??new ProjectStorageError("write",{cause:tx.error}));};
    });
  }finally{db.close();}
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
