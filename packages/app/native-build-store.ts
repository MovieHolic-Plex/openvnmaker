import {open,readFile,readdir,rename,unlink,stat} from "node:fs/promises";
import {join} from "node:path";
import {randomUUID} from "node:crypto";

export type NativePhase="upload"|"convert"|"lint"|"build"|"complete"|"failed"|"untracked"|"cancelling"|"cancelled";
export interface NativeJob {id:string;phase:NativePhase;log:string;error?:string;artifact?:string;size?:number;sha256?:string;compatibilitySha256?:string;compatibilityCounts?:{high:number;review:number;info:number};baselineJobId?:string;requestedBaselineJobId?:string;project?:{title:string;scenes:number;lines:number};createdAt:string}
export const validJobId=(id:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const phases=new Set<NativePhase>(["upload","convert","lint","build","complete","failed","untracked","cancelling","cancelled"]);
function validated(value:unknown,id:string):NativeJob{
  const row=value as NativeJob;
  if(!row||row.id!==id||!phases.has(row.phase)||typeof row.log!=="string"||row.log.length>48000||typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt)))throw new Error("손상된 빌드 기록입니다.");
  if(row.error!==undefined&&typeof row.error!=="string")throw new Error("손상된 빌드 오류 기록입니다.");
  if(row.baselineJobId!==undefined&&(typeof row.baselineJobId!=="string"||!validJobId(row.baselineJobId)||row.baselineJobId===id))throw new Error("손상된 이전 빌드 기준 ID입니다.");
  if(row.requestedBaselineJobId!==undefined&&(typeof row.requestedBaselineJobId!=="string"||!validJobId(row.requestedBaselineJobId)||row.requestedBaselineJobId===id))throw new Error("손상된 요청 빌드 기준 ID입니다.");
  if(row.artifact!==undefined&&(typeof row.artifact!=="string"||! /^vnmaker-[a-f0-9]{16}(?:[a-f0-9]{16})?-[a-zA-Z0-9._-]+-pc\.zip$/.test(row.artifact)))throw new Error("안전하지 않은 빌드 파일 경로입니다.");
  if(row.size!==undefined&&(!Number.isSafeInteger(row.size)||row.size<=0))throw new Error("손상된 빌드 크기 정보입니다.");
  if(row.sha256!==undefined&&(typeof row.sha256!=="string"||! /^[a-f0-9]{64}$/.test(row.sha256)))throw new Error("손상된 빌드 해시 정보입니다.");
  if(row.compatibilitySha256!==undefined&&(typeof row.compatibilitySha256!=="string"||! /^[a-f0-9]{64}$/.test(row.compatibilitySha256)))throw new Error("손상된 변경 검사 해시 정보입니다.");
  if(row.compatibilityCounts!==undefined&&(!row.compatibilitySha256||!row.compatibilityCounts||!["high","review","info"].every(key=>Number.isSafeInteger(row.compatibilityCounts![key as "high"])&&row.compatibilityCounts![key as "high"]>=0&&row.compatibilityCounts![key as "high"]<=1_000_000)))throw new Error("손상된 변경 검사 요약입니다.");
  if(row.phase==="complete"&&(!row.artifact||!row.size||!row.sha256))throw new Error("완료 정보가 빠진 빌드 기록입니다.");
  if(row.project&&(typeof row.project.title!=="string"||row.project.title.length>2000||!Number.isSafeInteger(row.project.scenes)||row.project.scenes<0||!Number.isSafeInteger(row.project.lines)||row.project.lines<0))throw new Error("손상된 작품 정보입니다.");
  return {id,phase:row.phase,log:row.log,createdAt:row.createdAt,...(row.compatibilityCounts?{compatibilityCounts:{high:row.compatibilityCounts.high,review:row.compatibilityCounts.review,info:row.compatibilityCounts.info}}:{}),...(row.compatibilitySha256?{compatibilitySha256:row.compatibilitySha256}:{}),...(row.requestedBaselineJobId?{requestedBaselineJobId:row.requestedBaselineJobId}:{}),...(row.baselineJobId?{baselineJobId:row.baselineJobId}:{}),...(row.error?{error:row.error}:{}),...(row.artifact?{artifact:row.artifact}:{}),...(row.size?{size:row.size}:{}),...(row.sha256?{sha256:row.sha256}:{}),...(row.project?{project:row.project}:{})};
}

/** Replace a fully written, flushed snapshot; an interrupted write leaves the prior snapshot intact. */
export async function saveNativeJob(root:string,job:NativeJob){
  if(!validJobId(job.id))throw new Error("잘못된 빌드 ID입니다.");
  const directory=join(root,job.id),temporary=join(directory,`status-${randomUUID()}.tmp`);
  try{const file=await open(temporary,"wx");try{await file.writeFile(JSON.stringify(job,null,2));await file.sync();}finally{await file.close();}await rename(temporary,join(directory,"status.json"));}
  catch(error){await unlink(temporary).catch(()=>undefined);throw error;}
}

export async function commitNativePhase(root:string,job:NativeJob,phase:NativePhase){
  await saveNativeJob(root,{...job,phase});
  job.phase=phase;
}

export async function loadNativeJob(root:string,id:string):Promise<NativeJob|undefined>{
  if(!validJobId(id))return;
  try{
    const path=join(root,id,"status.json");if((await stat(path)).size>256*1024)throw new Error("빌드 기록 크기 제한을 초과했습니다.");
    const job=validated(JSON.parse(await readFile(path,"utf8")),id);
    if(!["complete","failed","untracked","cancelled"].includes(job.phase)){
      // A status file alone cannot prove that another server or its child has stopped.
      job.phase="untracked";job.error="이 서버가 실행 상태를 추적하지 않는 작업입니다. 다른 서버에서 계속 실행 중인지 확인하세요. 자동으로 다시 빌드하지 않습니다.";
    }
    return job;
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
}

export async function listNativeJobs(root:string){
  const names=await readdir(root).catch(error=>{if(error.code==="ENOENT")return [];throw error;});
  const jobs:NativeJob[]=[],unreadable:string[]=[];
  for(const id of names.filter(validJobId))try{const job=await loadNativeJob(root,id);if(job)jobs.push(job);}catch{unreadable.push(id);}
  return {jobs:jobs.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),unreadable};
}
