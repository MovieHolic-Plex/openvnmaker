import {withNarrativeIds} from "./narrativeIds.js";
import {serializeLibraryArchive} from "./libraryArchive.js";
import {parseScript,type VnScript} from "@vnmaker/content";
import {PROJECT_KEY} from "./project.js";
export const ACTIVE_PROJECT_KEY="vnmaker.studio.active-project.v1";
export interface SavedProject {id:string;script:VnScript;updatedAt:number}
export function activateProject(id:string,script:VnScript):void {
  const previousId=localStorage.getItem(ACTIVE_PROJECT_KEY),previousScript=localStorage.getItem(PROJECT_KEY);
  try{localStorage.setItem(PROJECT_KEY,JSON.stringify(script));localStorage.setItem(ACTIVE_PROJECT_KEY,id);}
  catch(error){
    try{if(previousScript===null)localStorage.removeItem(PROJECT_KEY);else localStorage.setItem(PROJECT_KEY,previousScript);if(previousId===null)localStorage.removeItem(ACTIVE_PROJECT_KEY);else localStorage.setItem(ACTIVE_PROJECT_KEY,previousId);}catch{/* Both manuscripts remain in the durable project library. */}
    throw new Error("활성 작품을 저장하지 못했습니다. 원고는 작품 보관함에 유지됩니다.",{cause:error});
  }
}
export function newProject(title:string):VnScript {
  return withNarrativeIds(parseScript({title:title.trim(),subtitle:"",start:"start",characters:[],assets:[],assetLibraryMode:"project",flags:{},scenes:[{id:"start",chapter:"첫 번째 장면",background:"title",lines:[{speaker:null,text:"새로운 이야기가 시작됩니다."}],ending:"이야기의 끝"}]}));
}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open("vnmaker.projects",1);request.onupgradeneeded=()=>request.result.createObjectStore("projects",{keyPath:"id"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error("다른 탭의 작품 보관함을 닫고 다시 시도하세요."));});}
export async function saveProject(id:string,script:VnScript):Promise<void>{
  parseScript(script);const snapshot=structuredClone(script);const db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction("projects","readwrite",{durability:"strict"});tx.objectStore("projects").put({id,script:snapshot,updatedAt:Date.now()});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(new Error("작품 보관함에 저장하지 못했습니다. 현재 작품을 JSON으로 백업하세요."));};});
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
