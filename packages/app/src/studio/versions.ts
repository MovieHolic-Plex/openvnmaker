import { parseScript, type VnScript } from "@vnmaker/content";
import { scriptFingerprint } from "./production.js";
export interface ProjectVersion { id:string; projectId:string; createdAt:number; label:string; fingerprint:string; script:VnScript }
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open("vnmaker.project-history",1);request.onupgradeneeded=()=>request.result.createObjectStore("versions",{keyPath:"id"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error("다른 창의 버전 보관함을 닫고 다시 시도하세요."));});}
/** 이 프로젝트의 버전만 최신순으로 — 다른 작품의 원고가 이 작품에 복원되면 안 된다. */
export function ownVersions(rows:readonly ProjectVersion[],projectId:string):ProjectVersion[]{return rows.filter(row=>row.projectId===projectId).sort((a,b)=>b.createdAt-a.createdAt);}
/** 프로젝트당 20개를 넘은 오래된 버전 + projectId 없는 레거시 행을 지울 id 목록. */
export function staleVersionIds(rows:readonly ProjectVersion[],projectId:string):string[]{
  const stale=ownVersions(rows,projectId).slice(20).map(row=>row.id);
  const legacy=rows.filter(row=>typeof row.projectId!=="string"||row.projectId==="").map(row=>row.id);
  return [...stale,...legacy];
}
export async function listVersions(projectId:string):Promise<ProjectVersion[]>{const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction("versions","readonly").objectStore("versions").getAll();request.onsuccess=()=>resolve(ownVersions(request.result as ProjectVersion[],projectId));request.onerror=()=>reject(request.error);request.transaction!.oncomplete=()=>db.close();});}
export async function saveVersion(projectId:string,script:VnScript,label:string):Promise<ProjectVersion>{
  parseScript(script);
  const version={id:crypto.randomUUID(),projectId,createdAt:Date.now(),label:label.trim()||"작업 버전",fingerprint:scriptFingerprint(script),script:structuredClone(script)};
  const db=await database();return new Promise((resolve,reject)=>{const transaction=db.transaction("versions","readwrite");const store=transaction.objectStore("versions");store.put(version);const request=store.getAll();request.onsuccess=()=>{for(const stale of staleVersionIds(request.result as ProjectVersion[],projectId))store.delete(stale);};transaction.oncomplete=()=>{db.close();resolve(version);};transaction.onerror=()=>{db.close();reject(transaction.error);};transaction.onabort=()=>{db.close();reject(transaction.error);};});
}
