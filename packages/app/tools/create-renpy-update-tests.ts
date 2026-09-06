import {mkdir,readFile,writeFile,stat,readdir} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {readProjectBundle} from "../src/studio/restoreBundle.js";
import {createZip} from "../src/studio/zip.js";
import {saveNativeJob} from "../native-build-store.js";
import {writeUpdateQa} from "./write-renpy-update-qa.js";

const [bundleArg,sdkArg,outArg]=process.argv.slice(2);
if(!bundleArg||!sdkArg||!outArg)throw new Error("Usage: node --import tsx tools/create-renpy-update-tests.ts <arithmetic-game.zip> <sdk> <new-directory>");
const destination=path.resolve(outArg);if(await stat(destination).then(()=>true,()=>false))throw new Error("Use a new directory.");
const sdk=path.resolve(sdkArg),jobId=randomUUID(),jobRoot=path.join(destination,"history"),jobDirectory=path.join(jobRoot,jobId);
const {script,files}=await readProjectBundle(new Blob([await readFile(path.resolve(bundleArg))]));
if(script.title!=="누적 신뢰 검증")throw new Error("Use the arithmetic fixture.");
await mkdir(destination,{recursive:true});
const original={...script,nativeSaveId:"38f9c09deee5431fb99e9cb9073781be"};
const revised={...original,title:"누적 신뢰 검증 업데이트",flags:{...original.flags,chapterBonus:7},scenes:[...original.scenes].reverse().map(scene=>({...scene,lines:scene.lines.map(line=>({...line,text:line.text+" 업데이트."}))}))};
for(const [name,source] of Object.entries({original,revised})){
  const bundle=path.join(destination,`${name}.zip`);files["project.json"]=new TextEncoder().encode(JSON.stringify(source,null,2));
  await writeFile(bundle,new Uint8Array(await createZip(Object.entries(files).map(([path,bytes])=>({path,bytes}))).arrayBuffer()));
  const project=path.join(destination,name);
  execFileSync(process.execPath,["--import","tsx","tools/export-renpy.ts",bundle,sdk,project,...(name==="revised"?["--previous-build",jobDirectory]:[])],{cwd:path.resolve(import.meta.dirname,".."),windowsHide:true,stdio:"inherit"});
  if(name==="original"){
    const distribution=path.join(jobDirectory,"distribution");await mkdir(distribution,{recursive:true});
    execFileSync(path.join(sdk,"lib/py3-windows-x86_64/python.exe"),[path.join(sdk,"renpy.py"),"launcher","distribute",project,"--destination",distribution,"--package","pc"],{cwd:sdk,windowsHide:true,stdio:"inherit"});
    const artifact=(await readdir(distribution)).find(name=>name.endsWith("-pc.zip"))!;const archive=await readFile(path.join(distribution,artifact));
    await saveNativeJob(jobRoot,{id:jobId,phase:"complete",log:"Update compatibility fixture built with the real SDK",createdAt:new Date().toISOString(),artifact,size:archive.length,sha256:createHash("sha256").update(archive).digest("hex")});
  }
}
await writeUpdateQa(destination);
console.log("Run original/write_update, then revised/read_update as separate SDK processes with the SAME isolated savedir.");
