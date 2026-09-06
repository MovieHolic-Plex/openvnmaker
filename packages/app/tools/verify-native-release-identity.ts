import {readFile,writeFile,stat} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import {readProjectBundle} from "../src/studio/restoreBundle.js";
import {createZip} from "../src/studio/zip.js";

const [jobArg,sdkArg,outputArg]=process.argv.slice(2);
if(!jobArg||!sdkArg||!outputArg)throw new Error("Usage: node --import tsx tools/verify-native-release-identity.ts <completed-job-directory> <sdk> <new-revision-directory>");
const job=path.resolve(jobArg),destination=path.resolve(outputArg),bundle=`${destination}.zip`;
for(const file of [destination,bundle])if(await stat(file).then(()=>true,()=>false))throw new Error(`Use a new path: ${file}`);
const original=JSON.parse(await readFile(path.join(job,"project/release-identity.json"),"utf8"));assert.equal(original.stable,true);
const {script,files}=await readProjectBundle(new Blob([await readFile(path.join(job,"input.zip"))]));assert.equal(script.nativeSaveId,original.identity);
const revision={...script,title:`${script.title} — 업데이트`,scenes:script.scenes.map((scene,index)=>index?scene:{...scene,lines:scene.lines.map((line,n)=>n?line:{...line,text:`${line.text} 수정된 대사입니다.`})})};
files["project.json"]=new TextEncoder().encode(JSON.stringify(revision,null,2));
await writeFile(bundle,new Uint8Array(await createZip(Object.entries(files).map(([path,bytes])=>({path,bytes}))).arrayBuffer()));
execFileSync(process.execPath,["--import","tsx","tools/export-renpy.ts",bundle,path.resolve(sdkArg),destination],{cwd:path.resolve(import.meta.dirname,".."),stdio:"inherit",windowsHide:true});
const updated=JSON.parse(await readFile(path.join(destination,"release-identity.json"),"utf8"));assert.equal(updated.identity,original.identity);assert.equal(updated.saveDirectory,original.saveDirectory);assert.notEqual(updated.manuscriptHash,original.manuscriptHash);
for(const setting of ["config.save_directory","build.name"]){
  const extract=(text:string)=>text.split(/\r?\n/).find(line=>line.startsWith(`define ${setting} = `));
  const old=extract(await readFile(path.join(job,"project/game/options.rpy"),"utf8"));assert.ok(old);assert.equal(extract(await readFile(path.join(destination,"game/options.rpy"),"utf8")),old);
}
console.log(JSON.stringify({original,updated,verified:["title and dialogue changed","identity retained","save directory retained","build name retained"],saveCompatibility:"Not tested by this identity check"},null,2));
