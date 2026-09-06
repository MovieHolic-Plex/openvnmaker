import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,basename,sep} from "node:path";
import {spawn} from "node:child_process";
import {randomUUID,createHash} from "node:crypto";
import {saveNativeJob,loadNativeJob,listNativeJobs,commitNativePhase,type NativeJob} from "../native-build-store.js";
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.match(basename(root),/^vnmaker-(history|records)-/);await rm(root,{recursive:true,force:true});}

test("a different OS server process restores completed history, logs and verified downloads",async()=>{
  const root=await mkdtemp(join(tmpdir(),"vnmaker-history-")),app=join(root,"packages/app"),output=join(root,"output/editor-native-builds"),id=randomUUID();
  const directory=join(output,id),bytes=Buffer.from("retained build artifact fixture"),name="vnmaker-0123456789abcdef0123456789abcdef-1.0-pc.zip";
  await mkdir(join(directory,"distribution"),{recursive:true});await mkdir(app,{recursive:true});await writeFile(join(directory,"distribution",name),bytes);await writeFile(join(directory,"build.log"),"retained log\n");
  const job:NativeJob={id,phase:"complete",createdAt:new Date().toISOString(),log:"retained log\n",artifact:name,size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),baselineJobId:randomUUID(),project:{title:"기록 복원",scenes:1,lines:2}};job.requestedBaselineJobId=job.baselineJobId!;await saveNativeJob(output,job);
  const reportBytes=Buffer.from(JSON.stringify({version:1,fixture:"retained comparison bytes"}));await mkdir(join(directory,"project"));await writeFile(join(directory,"project/release-compatibility.json"),reportBytes);job.compatibilitySha256=createHash("sha256").update(reportBytes).digest("hex");job.compatibilityCounts={high:2,review:1,info:0};await saveNativeJob(output,job);
  const start=async()=>{
    const child=spawn(process.execPath,["--import","tsx","test/fixtures/native-history-server.ts",app],{cwd:resolve("."),windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let errors="";child.stderr.on("data",chunk=>{errors+=chunk;});
    const url=await new Promise<string>((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(new Error(`Server startup timeout: ${errors}`));},10000);child.once("error",error=>{clearTimeout(timeout);reject(error);});child.once("exit",code=>{clearTimeout(timeout);reject(new Error(`Server exited ${code}: ${errors}`));});let text="";child.stdout.on("data",chunk=>{text+=chunk;const line=text.split("\n").find(row=>row.startsWith("{"));if(line){clearTimeout(timeout);resolve(`http://127.0.0.1:${JSON.parse(line).port}`);}});});
    return {url,pid:child.pid,stop:()=>new Promise<void>(resolve=>{child.once("exit",()=>resolve());child.kill();})};
  };
  const headers={"X-VNMaker-Studio":"1"};let first:Awaited<ReturnType<typeof start>>|undefined,second:Awaited<ReturnType<typeof start>>|undefined;
  try{
    first=await start();assert.equal((await(await fetch(`${first.url}/api/native-build/jobs/${id}`,{headers})).json()).phase,"complete");const firstPid=first.pid;await first.stop();first=undefined;
    second=await start();assert.notEqual(firstPid,second.pid);const list=await(await fetch(`${second.url}/api/native-build/jobs`,{headers})).json();assert.equal(list.jobs[0].id,id);assert.equal(list.jobs[0].project.title,"기록 복원");assert.equal(list.jobs[0].baselineJobId,job.baselineJobId);assert.equal(list.jobs[0].requestedBaselineJobId,job.requestedBaselineJobId);assert.equal("log" in list.jobs[0],false);
    const baselineUrl=`${second.url}/api/native-build/baselines/0123456789abcdef0123456789abcdef`;
    assert.equal((await fetch(baselineUrl)).status,403);
    assert.equal((await fetch(baselineUrl+"?offset=-1",{headers})).status,400);
    for(let index=0;index<52;index++){const extra=randomUUID();await mkdir(join(output,extra));await saveNativeJob(output,{...job,id:extra,createdAt:new Date(1_600_000_000_000+index).toISOString()});}
    const pageOne=await(await fetch(baselineUrl,{headers})).json();assert.equal(pageOne.total,53);assert.equal(pageOne.jobs.length,50);assert.equal(pageOne.nextOffset,50);assert.equal(pageOne.jobs[0].id,id);
    const pageTwo=await(await fetch(baselineUrl+"?offset=50",{headers})).json();assert.equal(pageTwo.jobs.length,3);assert.equal(pageTwo.nextOffset,null);assert.equal(new Set([...pageOne.jobs,...pageTwo.jobs].map(row=>row.id)).size,53);
    assert.equal((await(await fetch(`${second.url}/api/native-build/baselines/fedcba9876543210`,{headers})).json()).total,0);
    const post=(value:string)=>fetch(`${second.url}/api/native-build/jobs`,{method:"POST",headers:{...headers,"Content-Type":"application/zip","X-VNMaker-Baseline":value},body:bytes});
    assert.equal((await post("../../outside")).status,400);assert.equal((await post(randomUUID())).status,409);
    const download=await fetch(`${second.url}/api/native-build/jobs/${id}/artifact`);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
    const comparison=await fetch(`${second.url}/api/native-build/jobs/${id}/compatibility`);assert.equal(comparison.status,200);assert.deepEqual(Buffer.from(await comparison.arrayBuffer()),reportBytes);assert.equal(list.jobs[0].compatibilitySha256,job.compatibilitySha256);assert.deepEqual(list.jobs[0].compatibilityCounts,job.compatibilityCounts);
    await writeFile(join(directory,"project/release-compatibility.json"),Buffer.alloc(reportBytes.length,1));assert.equal((await fetch(`${second.url}/api/native-build/jobs/${id}/compatibility`)).status,409);
    const malformed=await fetch(`${second.url}/api/native-build/compatibility`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:"{bad"});assert.equal(malformed.status,400);
    const invalidUtf8=await fetch(`${second.url}/api/native-build/compatibility`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:Buffer.from([0xff])});assert.equal(invalidUtf8.status,400);
    const oversized=await fetch(`${second.url}/api/native-build/compatibility`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:"x".repeat(8*1024*1024+1)});assert.equal(oversized.status,413);
    assert.equal(await(await fetch(`${second.url}/api/native-build/jobs/${id}/log`)).text(),"retained log\n");
    await writeFile(join(directory,"distribution",name),Buffer.alloc(bytes.length,1));assert.equal((await fetch(`${second.url}/api/native-build/jobs/${id}/artifact`)).status,409);
    assert.equal(await readFile(join(directory,"status.json"),"utf8"),JSON.stringify(job,null,2));
  }finally{await first?.stop();await second?.stop();await cleanup(root);}
});

test("invalid records cannot choose filesystem paths and unfinished records do not prove termination",async()=>{
  const root=await mkdtemp(join(tmpdir(),"vnmaker-records-"));
  try{
    const id=randomUUID();await mkdir(join(root,id));const job:NativeJob={id,phase:"build",log:"building",createdAt:new Date().toISOString()};await saveNativeJob(root,job);
    await assert.rejects(commitNativePhase(join(root,"missing"),job,"complete"));assert.equal(job.phase,"build");
    const restored=await loadNativeJob(root,id);assert.equal(restored?.phase,"untracked");assert.match(restored?.error??"",/계속 실행 중/);assert.equal(JSON.parse(await readFile(join(root,id,"status.json"),"utf8")).phase,"build");
    await writeFile(join(root,id,"status.json"),JSON.stringify({...job,phase:"complete",artifact:"../../private.zip",size:1,sha256:"a".repeat(64)}));await assert.rejects(loadNativeJob(root,id),/경로/);assert.equal((await listNativeJobs(root)).unreadable.length,1);assert.equal(await loadNativeJob(root,"../outside"),undefined);
    await writeFile(join(root,id,"status.json"),"{partial");await assert.rejects(loadNativeJob(root,id));
    job.error="interrupted write test";await commitNativePhase(root,job,"failed");assert.equal(job.phase,"failed");assert.equal((await loadNativeJob(root,id))?.phase,"failed");
    await commitNativePhase(root,job,"cancelled");assert.equal((await loadNativeJob(root,id))?.phase,"cancelled");
  }finally{await cleanup(root);}
});
