import { parseScript, type VnScript } from "@vnmaker/content";
import { scriptFingerprint } from "./production.js";
export interface ProjectVersion { id:string; createdAt:number; label:string; fingerprint:string; script:VnScript }
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open("vnmaker.project-history",1);request.onupgradeneeded=()=>request.result.createObjectStore("versions",{keyPath:"id"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error("다른 창의 버전 보관함을 닫고 다시 시도하세요."));});}
export async function listVersions():Promise<ProjectVersion[]>{const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction("versions","readonly").objectStore("versions").getAll();request.onsuccess=()=>resolve((request.result as ProjectVersion[]).sort((a,b)=>b.createdAt-a.createdAt));request.onerror=()=>reject(request.error);request.transaction!.oncomplete=()=>db.close();});}
export async function saveVersion(script:VnScript,label:string):Promise<ProjectVersion>{
  parseScript(script);
  const version={id:crypto.randomUUID(),createdAt:Date.now(),label:label.trim()||"작업 버전",fingerprint:scriptFingerprint(script),script:structuredClone(script)};
  const db=await database();return new Promise((resolve,reject)=>{const transaction=db.transaction("versions","readwrite");const store=transaction.objectStore("versions");store.put(version);const request=store.getAll();request.onsuccess=()=>{const rows=(request.result as ProjectVersion[]).sort((a,b)=>b.createdAt-a.createdAt);for(const stale of rows.slice(20))store.delete(stale.id);};transaction.oncomplete=()=>{db.close();resolve(version);};transaction.onerror=()=>{db.close();reject(transaction.error);};transaction.onabort=()=>{db.close();reject(transaction.error);};});
}
