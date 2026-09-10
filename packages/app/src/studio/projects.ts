import {withNarrativeIds} from "./narrativeIds.js";
import {serializeLibraryArchive} from "./libraryArchive.js";
import {parseScript,type VnScript} from "@vnmaker/content";
import {PROJECT_KEY} from "./project.js";
import {canonicalJson,parseDecisionReceipt,parseProjectHead,type DecisionReceipt,type ProjectHead,type ProductionDocument} from "@vnmaker/harness";
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
export type StoredDecision={
  readonly projectId:string;readonly lineageId:string;readonly proposalId:string;
  readonly receipt:DecisionReceipt;readonly ackStatus:"pending"|"acked";
};
export function parseStoredDecision(value:unknown):StoredDecision{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new ProjectStorageError("damaged");
  if(!("projectId" in value)||!("lineageId" in value)||!("proposalId" in value)||!("receipt" in value)||!("ackStatus" in value))throw new ProjectStorageError("damaged");
  if(value.ackStatus!=="pending"&&value.ackStatus!=="acked")throw new ProjectStorageError("damaged");
  if(typeof value.projectId!=="string"||typeof value.lineageId!=="string"||typeof value.proposalId!=="string")throw new ProjectStorageError("damaged");
  const receipt=parseDecisionReceipt(value.receipt);
  if(value.projectId!==receipt.projectId||value.lineageId!==receipt.lineageId||value.proposalId!==receipt.proposalId)throw new ProjectStorageError("damaged");
  return {projectId:receipt.projectId,lineageId:receipt.lineageId,proposalId:receipt.proposalId,receipt,ackStatus:value.ackStatus};
}
export type StoredCommit={
  readonly record:SavedProject;readonly head:ProjectHead;readonly productionDocument:ProductionDocument;
  readonly expectedHead:ProjectHead|null;readonly expectedRecord:unknown;readonly metadataOnly:boolean;
  readonly decision?:StoredDecision;
};
/** Hashing/validation happens before this call. Only IDB requests run inside the transaction. */
export async function commitStoredProject(commit:StoredCommit,checkGeneration:()=>void,signal?:AbortSignal):Promise<void>{
  const db=await database();
  try{
    checkGeneration();
    signal?.throwIfAborted();
    await new Promise<void>((resolve,reject)=>{
      const stores=commit.decision===undefined
        ?["projects","project-heads","production-documents"]
        :["projects","project-heads","production-documents","proposal-decisions"];
      const tx=db.transaction(stores,"readwrite",{durability:"strict"});
      let failure:unknown;
      const abort=()=>{failure=signal?.reason;tx.abort();};
      signal?.addEventListener("abort",abort,{once:true});
      const record=tx.objectStore("projects").get(commit.record.id),head=tx.objectStore("project-heads").get(commit.record.id);
      const decisionGet=commit.decision===undefined?null:tx.objectStore("proposal-decisions").get([commit.decision.projectId,commit.decision.lineageId,commit.decision.proposalId]);
      const write=()=>{try{
        checkGeneration();
        if(commit.expectedHead===null){
          if(head.result!==undefined || canonicalJson(record.result??null)!==canonicalJson(commit.expectedRecord??null))throw new ProjectStorageError("stale-head");
        }else if(head.result===undefined||!sameHead(parseProjectHead(head.result),commit.expectedHead))throw new ProjectStorageError("stale-head");
        if(commit.decision!==undefined){
          if(decisionGet?.result!==undefined)throw new ProjectStorageError("stale-head");
          tx.objectStore("proposal-decisions").put(commit.decision);
        }
        if(!commit.metadataOnly)tx.objectStore("projects").put(commit.record);
        tx.objectStore("project-heads").put(commit.head);
        tx.objectStore("production-documents").put({projectId:commit.head.projectId,document:commit.productionDocument});
      }catch(error){failure=error;tx.abort();}};
      head.onsuccess=()=>{if(decisionGet===null||decisionGet.readyState==="done")write();else decisionGet.onsuccess=write;};
      tx.oncomplete=()=>{signal?.removeEventListener("abort",abort);resolve();};
      tx.onabort=()=>{signal?.removeEventListener("abort",abort);reject(failure??new ProjectStorageError("write",{cause:tx.error}));};
    });
  }finally{db.close();}
}
export async function readProposalDecision(projectId:string,lineageId:string,proposalId:string):Promise<StoredDecision|null>{
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction("proposal-decisions"),request=tx.objectStore("proposal-decisions").get([projectId,lineageId,proposalId]);
    tx.oncomplete=()=>resolve(request.result===undefined?null:parseStoredDecision(request.result));
    tx.onabort=()=>reject(new ProjectStorageError("damaged",{cause:tx.error}));
  });}finally{db.close();}
}
export async function listProposalDecisions(projectId:string):Promise<readonly StoredDecision[]>{
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction("proposal-decisions"),request=tx.objectStore("proposal-decisions").getAll();
    tx.oncomplete=()=>{
      const rows:StoredDecision[]=[];
      for(const value of request.result){try{const row=parseStoredDecision(value);if(row.projectId===projectId)rows.push(row);}catch{/* Keep damaged decision rows. */}}
      resolve(rows);
    };
    tx.onabort=()=>reject(new ProjectStorageError("damaged",{cause:tx.error}));
  });}finally{db.close();}
}
export async function markProposalAcked(projectId:string,lineageId:string,proposalId:string):Promise<void>{
  const db=await database();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction("proposal-decisions","readwrite",{durability:"strict"});
    let failure:unknown;
    const store=tx.objectStore("proposal-decisions"),request=store.get([projectId,lineageId,proposalId]);
    request.onsuccess=()=>{try{
      if(request.result===undefined)throw new ProjectStorageError("missing");
      const row=parseStoredDecision(request.result);
      if(row.ackStatus!=="acked")store.put({projectId:row.projectId,lineageId:row.lineageId,proposalId:row.proposalId,receipt:row.receipt,ackStatus:"acked"});
    }catch(error){failure=error;tx.abort();}};
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(failure??new ProjectStorageError("write",{cause:tx.error}));
  });}finally{db.close();}
}
export async function commitRejectedDecision(row:StoredDecision):Promise<void>{
  const db=await database();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction("proposal-decisions","readwrite",{durability:"strict"});
    let failure:unknown;
    const store=tx.objectStore("proposal-decisions"),request=store.get([row.projectId,row.lineageId,row.proposalId]);
    request.onsuccess=()=>{try{
      if(request.result!==undefined)throw new ProjectStorageError("stale-head");
      store.put(row);
    }catch(error){failure=error;tx.abort();}};
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(failure??new ProjectStorageError("write",{cause:tx.error}));
  });}finally{db.close();}
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
