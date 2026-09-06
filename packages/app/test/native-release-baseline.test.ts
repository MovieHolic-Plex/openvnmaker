import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {join,resolve,sep,basename} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID,createHash} from "node:crypto";
import {zipSync,strToU8} from "fflate";
import {saveNativeJob} from "../native-build-store.js";
import {installNativeBaseline,latestNativeBaseline,readNativeBaseline,nativeCompatibilityReport} from "../native-release-baseline.js";
import {arithmeticStory} from "./fixtures/arithmetic-story.js";
const identity="0123456789abcdef0123456789abcdef";
async function fixture(root:string,nativeSaveId=identity){
  const id=randomUUID(),directory=join(root,id),artifact=`vnmaker-${identity}-1.0-pc.zip`,prefix=artifact.slice(0,-4)+"/game/";
  const bytes=zipSync({[prefix+"project.json"]:strToU8(JSON.stringify({...arithmeticStory,nativeSaveId})),[prefix+"script.rpyc"]:strToU8("compiled-fixture-not-executed"),[prefix+"vn_qa.rpyc"]:strToU8("exclude")});
  await mkdir(join(directory,"distribution"),{recursive:true});await writeFile(join(directory,"distribution",artifact),bytes);
  const job={id,phase:"complete" as const,createdAt:new Date().toISOString(),log:"",artifact,size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};await saveNativeJob(root,job);return {directory,job};
}
async function scoped(run:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),"vnmaker-baseline-"));try{await run(root);}finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.match(basename(root),/^vnmaker-baseline-/);await rm(root,{recursive:true,force:true});}}
test("baseline reuses only the verified matching local build and records provenance",()=>scoped(async root=>{
  const {directory,job}=await fixture(root);assert.equal(await latestNativeBaseline(root,identity),directory);assert.equal(await latestNativeBaseline(root,"fedcba9876543210"),undefined);
  const target=join(root,"new-project"),result=await installNativeBaseline(target,identity,directory);assert.equal(result.jobId,job.id);assert.equal(result.artifactSha256,job.sha256);assert.equal(await readFile(join(target,"old-game/script.rpyc"),"utf8"),"compiled-fixture-not-executed");await assert.rejects(readFile(join(target,"old-game/vn_qa.rpyc")));
  const source={...arithmeticStory,nativeSaveId:identity,flags:{trust:"changed"}},baseline=await readNativeBaseline(identity,directory),report=nativeCompatibilityReport(source,baseline);assert.equal(report.baseline.artifactSha256,job.sha256);assert.ok(report.analysis.issues.some(issue=>issue.code==="flag-type"));
  await installNativeBaseline(target,identity,directory,source);assert.deepEqual(JSON.parse(await readFile(join(target,"release-compatibility.json"),"utf8")),report);
}));
test("altered archives and mismatched manuscripts cannot become executable baselines",()=>scoped(async root=>{
  const first=await fixture(root);const archive=join(first.directory,"distribution",first.job.artifact),bytes=await readFile(archive);bytes[bytes.length-1]^=1;await writeFile(archive,bytes);
  await assert.rejects(installNativeBaseline(join(root,"rejected"),identity,first.directory),/완료 기록/);
  const other=await fixture(root,"fedcba9876543210");await assert.rejects(installNativeBaseline(join(root,"mismatch"),identity,other.directory),/배포 ID/);
  await assert.rejects(installNativeBaseline(join(root,"wrong"),"fedcba9876543210",other.directory),/같은 작품/);
}));
test("a malformed record for the same release blocks silent fallback to another build",()=>scoped(async root=>{
  const {directory,job}=await fixture(root);await writeFile(join(directory,"status.json"),JSON.stringify({...job,sha256:"broken"}));await assert.rejects(latestNativeBaseline(root,identity),/손상/);
}));
