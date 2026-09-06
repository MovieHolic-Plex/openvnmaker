import type {Plugin} from "vite";
import type {IncomingMessage,ServerResponse} from "node:http";
import {randomUUID,createHash} from "node:crypto";
import {createReadStream,createWriteStream,appendFileSync} from "node:fs";
import {mkdir,stat,readdir,writeFile,readFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {loadNativeJob,listNativeJobs,commitNativePhase,validJobId,type NativeJob as Job,type NativePhase as Phase} from "./native-build-store.js";
import {nativeProcess} from "./native-process.js";
import {parseScript} from "../content/src/parse.js";
import {readNativeBaseline,latestNativeBaseline,nativeCompatibilityReport} from "./native-release-baseline.js";

const PREFIX="/api/native-build";
const MAX_UPLOAD=512*1024*1024;
const MAX_MANUSCRIPT=8*1024*1024;
async function readManuscript(req:IncomingMessage){
  return new Promise<unknown>((accept,reject)=>{
    let size=0,chunks:Buffer[]=[];req.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size<=MAX_MANUSCRIPT)chunks.push(chunk);else chunks=[];});
    req.once("error",reject);req.once("aborted",()=>reject(new Error("원고 전송이 중단됐습니다.")));
    req.once("end",()=>{try{if(size>MAX_MANUSCRIPT)throw new Error("비교 원고는 8MB 이하여야 합니다.");accept(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks))));}catch(error){reject(error);}});
  });
}
const localAddress=(address:string|undefined)=>address==="127.0.0.1"||address==="::1"||address==="::ffff:127.0.0.1";
export function nativeRequestAllowed(req:Pick<IncomingMessage,"headers"|"socket">){
  const host=req.headers.host;
  if(!localAddress(req.socket.remoteAddress)||!host||! /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))return false;
  return (!req.headers.origin||req.headers.origin===`http://${host}`)&&req.headers["sec-fetch-site"]!=="cross-site";
}

/** Local SDK execution is opt-in through server configuration, never a browser-provided command. */
export function nativeBuildPlugin(appRoot:string,sdkSetting:string|undefined):Plugin{
  const sdk=sdkSetting?resolve(appRoot,sdkSetting):undefined,output=resolve(appRoot,"../../output/editor-native-builds");
  const jobs=new Map<string,Job>(),cancellations=new Set<string>(),writes=new Map<string,Promise<void>>(),runner=nativeProcess();let active:string|undefined;
  const directory=(id:string)=>join(output,id);
  async function available(){return process.platform==="win32"&&!!sdk&&await Promise.all(["renpy.py","lib/py3-windows-x86_64/python.exe"].map(name=>stat(join(sdk,name)).then(value=>value.isFile(),()=>false))).then(rows=>rows.every(Boolean));}
  async function update(job:Job,phase:Phase){
    const pending=(writes.get(job.id)??Promise.resolve()).catch(()=>undefined).then(async()=>{if(cancellations.has(job.id)&&!["cancelling","cancelled","failed"].includes(phase))throw new Error("사용자가 빌드를 취소했습니다.");await commitNativePhase(output,job,phase);});writes.set(job.id,pending);await pending;
  }
  async function lookup(id:string){return jobs.get(id)??await loadNativeJob(output,id);}
  async function run(job:Job,exe:string,args:string[],cwd:string){
    if(cancellations.has(job.id))throw new Error("사용자가 빌드를 취소했습니다.");
    try{await runner.run(exe,args,cwd,data=>{job.log=(job.log+data.toString()).slice(-48000);appendFileSync(join(directory(job.id),"build.log"),data);});}
    catch(error){throw new Error(`${job.phase}: ${error instanceof Error?error.message:String(error)}`);}
    if(cancellations.has(job.id))throw new Error("사용자가 빌드를 취소했습니다.");
  }
  function stop(){void runner.stop().catch(()=>undefined);}
  async function build(job:Job){
    const root=directory(job.id),project=join(root,"project"),dist=join(root,"distribution"),python=join(sdk!,"lib/py3-windows-x86_64/python.exe"),renpy=join(sdk!,"renpy.py");
    try{
      const baselineArgs=job.requestedBaselineJobId?["--previous-build",directory(job.requestedBaselineJobId)]:["--history-root",output];
      await update(job,"convert");await run(job,process.execPath,["--import","tsx","tools/export-renpy.ts",join(root,"input.zip"),sdk!,project,...baselineArgs],appRoot);
      const manuscript=JSON.parse(await readFile(join(project,"game/project.json"),"utf8"));
      const baseline=await readFile(join(project,"release-baseline.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return undefined;throw error;});
      if(baseline)job.baselineJobId=JSON.parse(baseline).jobId;
      const comparison=await readFile(join(project,"release-compatibility.json")).catch(error=>{if(error.code==="ENOENT")return undefined;throw error;});
      if(comparison){job.compatibilitySha256=createHash("sha256").update(comparison).digest("hex");job.compatibilityCounts=JSON.parse(comparison.toString("utf8")).analysis.counts;}
      job.project={title:manuscript.title,scenes:manuscript.scenes.length,lines:manuscript.scenes.reduce((sum:number,scene:{lines:unknown[]})=>sum+scene.lines.length,0)};
      await update(job,"lint");await run(job,python,[renpy,project,"lint","--error-code"],sdk!);
      await update(job,"build");await run(job,python,[renpy,"launcher","distribute",project,"--destination",dist,"--package","pc"],sdk!);
      const archives=(await readdir(dist)).filter(name=>name.endsWith("-pc.zip"));if(archives.length!==1)throw new Error("빌드 결과 ZIP을 확인하지 못했습니다.");
      job.artifact=archives[0]!;job.size=(await stat(join(dist,job.artifact))).size;
      const hash=createHash("sha256");for await(const bytes of createReadStream(join(dist,job.artifact)))hash.update(bytes);job.sha256=hash.digest("hex");await update(job,"complete");
    }catch(error){const phase=cancellations.has(job.id)?"cancelled":"failed";job.error=phase==="cancelled"?"사용자가 빌드를 취소했습니다.":error instanceof Error?error.message:String(error);delete job.artifact;delete job.size;delete job.sha256;await update(job,phase).catch(()=>{job.phase=phase;});}
    finally{active=undefined;writes.delete(job.id);cancellations.delete(job.id);}
  }
  function send(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify(value));}
  function middleware(req:IncomingMessage,res:ServerResponse,next:()=>void){
    const path=(req.url??"").split("?")[0]!;if(!path.startsWith(PREFIX)){next();return;}
    void(async()=>{
      if(!nativeRequestAllowed(req)){send(res,403,{error:"네이티브 빌드는 같은 컴퓨터의 로컬 편집기에서만 사용할 수 있습니다."});return;}
      const match=path.match(/^\/api\/native-build\/jobs\/([a-f0-9-]{36})(?:\/(artifact|log|cancel|compatibility))?$/);
      if(req.method==="GET"&&match?.[2]&&match[2]!=="cancel"){
        const job=await lookup(match[1]!);if(!job||match[2]==="artifact"&&job.phase!=="complete"){send(res,404,{error:"빌드 결과가 없습니다."});return;}
        if(match[2]==="compatibility"){
          if(!job.compatibilitySha256){send(res,404,{error:"이 빌드에는 보관된 변경 검사 기록이 없습니다."});return;}
          const reportPath=join(directory(job.id),"project/release-compatibility.json");if((await stat(reportPath)).size>4*1024*1024)throw new Error("변경 검사 기록 크기를 초과했습니다.");
          const bytes=await readFile(reportPath);if(createHash("sha256").update(bytes).digest("hex")!==job.compatibilitySha256){send(res,409,{error:"변경 검사 기록이 빌드 당시 해시와 다릅니다."});return;}
          res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="${job.id}-compatibility.json"`);res.setHeader("Cache-Control","no-store");res.end(bytes);return;
        }
        const target=match[2]==="artifact"?join(directory(job.id),"distribution",job.artifact!):join(directory(job.id),"build.log");
        const info=await stat(target);
        if(match[2]==="artifact"){const digest=createHash("sha256");for await(const bytes of createReadStream(target))digest.update(bytes);if(info.size!==job.size||digest.digest("hex")!==job.sha256){send(res,409,{error:"빌드 파일이 완료 기록과 다릅니다. 원본을 복구하거나 새로 빌드하세요."});return;}}
        res.setHeader("Content-Type",match[2]==="artifact"?"application/zip":"text/plain; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="${match[2]==="artifact"?job.artifact:"build.log"}"`);res.setHeader("Content-Length",info.size);res.setHeader("Cache-Control","no-store");await pipeline(createReadStream(target),res);return;
      }
      if(req.headers["x-vnmaker-studio"]!=="1"){send(res,403,{error:"편집기 요청 헤더가 필요합니다."});return;}
      if(req.method==="POST"&&path===`${PREFIX}/compatibility`){
        if(req.headers["content-type"]?.split(";")[0]!=="application/json"||Number(req.headers["content-length"])>MAX_MANUSCRIPT){req.resume();send(res,413,{error:"8MB 이하의 JSON 원고가 필요합니다."});return;}
        const requested=req.headers["x-vnmaker-baseline"];
        if(requested!==undefined&&(typeof requested!=="string"||!validJobId(requested))){req.resume();send(res,400,{error:"이전 빌드 기준 ID가 올바르지 않습니다."});return;}
        if(requested){const job=await lookup(requested);if(!job||job.phase!=="complete"){req.resume();send(res,409,{error:"선택한 기준 빌드가 없거나 완료되지 않았습니다."});return;}}
        let script;try{script=parseScript(await readManuscript(req));}catch(error){send(res,400,{error:error instanceof Error?error.message:String(error)});return;}
        if(!script.nativeSaveId){send(res,400,{error:"비교할 작품의 고정 배포 ID가 필요합니다."});return;}
        const previous=requested?directory(requested):await latestNativeBaseline(output,script.nativeSaveId);
        if(!previous){send(res,404,{error:"이 작품의 기준 빌드가 없습니다. 아직 변경 비교를 할 수 없습니다."});return;}
        const baseline=await readNativeBaseline(script.nativeSaveId,previous);
        send(res,200,nativeCompatibilityReport(script,baseline));return;
      }
      if(req.method==="POST"&&match?.[2]==="cancel"){
        const job=jobs.get(match[1]!);if(!job||active!==job.id||["upload","complete","failed","cancelled"].includes(job.phase)){send(res,409,{error:"이 서버가 원본 전송을 마치고 진행 중인 작업만 취소할 수 있습니다."});return;}
        if(cancellations.has(job.id)){send(res,202,{id:job.id});return;}
        cancellations.add(job.id);await update(job,"cancelling");await runner.stop();send(res,202,{id:job.id});return;
      }
      if(req.method==="GET"&&path===`${PREFIX}/capabilities`){send(res,200,{available:await available(),active,platform:process.platform,message:sdk?"설정된 Ren’Py SDK를 확인하세요.":"로컬 서버에 Ren’Py SDK 경로를 설정한 뒤 다시 여세요."});return;}
      const release=path.match(/^\/api\/native-build\/baselines\/([a-f0-9]{16}(?:[a-f0-9]{16})?)$/);
      if(req.method==="GET"&&release){
        const offsetText=new URL(req.url!,"http://localhost").searchParams.get("offset")??"0";
        if(!/^(0|[1-9][0-9]{0,6})$/.test(offsetText)){send(res,400,{error:"기준 목록 위치가 올바르지 않습니다."});return;}
        const offset=Number(offsetText),stored=await listNativeJobs(output),rows=stored.jobs.filter(job=>job.phase==="complete"&&job.artifact?.startsWith(`vnmaker-${release[1]}-`));
        send(res,200,{jobs:rows.slice(offset,offset+50).map(({id,createdAt,project,sha256})=>({id,createdAt,project,sha256})),total:rows.length,nextOffset:offset+50<rows.length?offset+50:null,unreadable:stored.unreadable.length});return;
      }
      if(req.method==="GET"&&path===`${PREFIX}/jobs`){const stored=await listNativeJobs(output);const merged=new Map(stored.jobs.map(job=>[job.id,job]));for(const job of jobs.values())merged.set(job.id,job);const rows=[...merged.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));send(res,200,{jobs:rows.slice(0,50).map(({log,...row})=>row),total:rows.length,unreadable:stored.unreadable.length});return;}
      if(req.method==="GET"&&match&&!match[2]){const job=await lookup(match[1]!);send(res,job?200:404,job??{error:"빌드 기록을 찾을 수 없습니다."});return;}
      if(req.method!=="POST"||path!==`${PREFIX}/jobs`){send(res,404,{error:"알 수 없는 빌드 요청입니다."});return;}
      const requestedBaseline=req.headers["x-vnmaker-baseline"];
      if(requestedBaseline!==undefined&&(typeof requestedBaseline!=="string"||!validJobId(requestedBaseline))){send(res,400,{error:"이전 빌드 기준은 완료된 로컬 작업 ID여야 합니다."});return;}
      if(requestedBaseline){const baseline=await lookup(requestedBaseline);if(!baseline||baseline.phase!=="complete"){send(res,409,{error:"선택한 기준 빌드가 없거나 완료되지 않았습니다."});return;}}
      if(!await available()){send(res,503,{error:"Windows용 Ren’Py SDK 경로가 설정되지 않았거나 SDK를 찾을 수 없습니다."});return;}
      if(active){send(res,409,{error:"이미 빌드 중인 작품이 있습니다.",id:active});return;}
      if(req.headers["content-type"]!=="application/zip"||Number(req.headers["content-length"])>MAX_UPLOAD){send(res,413,{error:"512MB 이하의 게임 ZIP이 필요합니다."});return;}
      const job:Job={id:randomUUID(),phase:"upload",log:"",createdAt:new Date().toISOString(),...(requestedBaseline?{requestedBaselineJobId:requestedBaseline}:{})};active=job.id;jobs.set(job.id,job);
      try{
        await mkdir(directory(job.id),{recursive:true});await writeFile(join(directory(job.id),"build.log"),"");await update(job,"upload");let bytes=0;
        const limit=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>MAX_UPLOAD?new Error("업로드는 512MB 이하여야 합니다."):null,chunk);}});
        await pipeline(req,limit,createWriteStream(join(directory(job.id),"input.zip"),{flags:"wx"}));
        if(!bytes)throw new Error("비어 있는 게임 ZIP입니다.");send(res,202,{id:job.id});void build(job);
      }catch(error){active=undefined;job.error=String(error);await update(job,"failed").catch(()=>{job.phase="failed";});throw error;}
    })().catch(error=>{if(!res.headersSent)send(res,500,{error:error instanceof Error?error.message:String(error)});else res.destroy();});
  }
  return {name:"vnmaker-native-build",configureServer(server){server.middlewares.use(middleware);server.httpServer?.once("close",stop);},configurePreviewServer(server){server.middlewares.use(middleware);server.httpServer.once("close",stop);}};
}
