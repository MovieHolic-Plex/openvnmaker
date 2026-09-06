import {readFile,mkdir,writeFile,stat} from "node:fs/promises";
import {join,basename,dirname} from "node:path";
import {createHash} from "node:crypto";
import {unzipSync} from "fflate";
import {listNativeJobs,loadNativeJob} from "./native-build-store.js";
import {nativeIdentity} from "./native-identity.js";
import type {VnScript} from "@vnmaker/content";
import {compareNativeManuscripts,type NativeCompatibilityReport} from "./src/studio/nativeCompatibility.js";

/** Only a completed local build, verified against its retained archive hash, is a code baseline. */
export async function readNativeBaseline(identity:string,jobDirectory:string){
  const job=await loadNativeJob(dirname(jobDirectory),basename(jobDirectory));
  if(!job||job.phase!=="complete"||!job.artifact?.startsWith(`vnmaker-${identity}-`))throw new Error("이전 빌드가 완료된 같은 작품이 아닙니다.");
  const archive=join(jobDirectory,"distribution",job.artifact),size=(await stat(archive)).size;
  if(size!==job.size||size>1024*1024*1024)throw new Error("이전 빌드 ZIP 크기가 기록과 다르거나 1GB를 초과합니다.");
  const bytes=await readFile(archive);
  if(createHash("sha256").update(bytes).digest("hex")!==job.sha256)throw new Error("이전 빌드 ZIP이 완료 기록과 다릅니다.");
  const prefix=job.artifact.replace(/\.zip$/,"")+"/game/";
  const wanted=new Set([prefix+"project.json",prefix+"script.rpyc"]);
  const seen=new Set<string>();let total=0;
  const files=unzipSync(bytes,{filter(entry){if(!wanted.has(entry.name))return false;if(seen.has(entry.name))throw new Error("이전 빌드 파일이 중복됩니다.");seen.add(entry.name);total+=entry.originalSize;if(total>32*1024*1024)throw new Error("이전 원고 기준 파일 크기를 초과했습니다.");return true;}});
  if(!files[prefix+"project.json"]||!files[prefix+"script.rpyc"])throw new Error("이전 빌드에 원고 또는 컴파일 기준 파일이 없습니다.");
  const manuscript=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(files[prefix+"project.json"]));
  if(nativeIdentity(manuscript).identity!==identity)throw new Error("이전 빌드 원고의 배포 ID가 다릅니다.");
  return {manuscript:manuscript as VnScript,compiled:files[prefix+"script.rpyc"]!,provenance:{jobId:job.id,artifactSha256:job.sha256!,identity}};
}

export function nativeCompatibilityReport(current:VnScript,baseline:Awaited<ReturnType<typeof readNativeBaseline>>):NativeCompatibilityReport{
  return {version:1,baseline:{jobId:baseline.provenance.jobId,artifactSha256:baseline.provenance.artifactSha256,manuscriptHash:nativeIdentity(baseline.manuscript).manuscriptHash},currentManuscriptHash:nativeIdentity(current).manuscriptHash,analysis:compareNativeManuscripts(baseline.manuscript,current)};
}

export async function installNativeBaseline(destination:string,identity:string,jobDirectory:string,current?:VnScript){
  const baseline=await readNativeBaseline(identity,jobDirectory);
  await mkdir(join(destination,"old-game"),{recursive:true});
  await writeFile(join(destination,"old-game/script.rpyc"),baseline.compiled);
  const result=baseline.provenance;
  await writeFile(join(destination,"release-baseline.json"),JSON.stringify(result,null,2));
  if(current)await writeFile(join(destination,"release-compatibility.json"),JSON.stringify(nativeCompatibilityReport(current,baseline),null,2));
  return result;
}

export async function latestNativeBaseline(historyRoot:string,identity:string){
  const {jobs,unreadable}=await listNativeJobs(historyRoot);
  for(const id of unreadable){
    const file=join(historyRoot,id,"status.json");let value;
    try{if((await stat(file)).size<=256*1024)value=JSON.parse(await readFile(file,"utf8"));}catch{/* The history UI already reports unreadable records. */}
    if(typeof value?.artifact==="string"&&value.artifact.startsWith(`vnmaker-${identity}-`))throw new Error("같은 작품의 이전 빌드 기록이 손상되었습니다. 기준 기록을 복구하세요.");
  }
  if(unreadable.length)console.warn(`이전 빌드 검색에서 읽을 수 없는 기록 ${unreadable.length}개를 제외했습니다.`);
  const job=jobs.find(job=>job.phase==="complete"&&job.artifact?.startsWith(`vnmaker-${identity}-`));
  return job?join(historyRoot,job.id):undefined;
}
