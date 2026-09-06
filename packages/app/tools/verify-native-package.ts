import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {unzipSync} from "fflate";
const [archiveArg,directoryArg,reportArg]=process.argv.slice(2);
if(!archiveArg||!directoryArg||!reportArg)throw new Error("Usage: verify-native-package.ts <original.zip> <extracted-game-directory> <report.json>");
const archive=await readFile(path.resolve(archiveArg)),directory=path.resolve(directoryArg);
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const files=unzipSync(archive),roots=new Set(Object.keys(files).map(name=>name.split("/")[0]));
if(roots.size!==1)throw new Error("Expected one package root.");
const checks:{file:string;sha256:string;matches:boolean;runtimeCache:boolean}[]=[];
for(const [name,bytes] of Object.entries(files)){
  if(name.endsWith("/"))continue;
  const relative=name.split("/").slice(1).join("/");
  if(!relative||relative.split("/").some(part=>part===".."||part==="."||part.includes("\\")||part.includes(":")))throw new Error(`Invalid package path: ${name}`);
  const file=path.resolve(directory,relative);
  if(!file.startsWith(directory+path.sep))throw new Error(`Path escapes package: ${name}`);
  const actual=await readFile(file).catch(()=>null);
  checks.push({file:relative,sha256:hash(bytes),matches:actual!==null&&hash(actual)===hash(bytes),runtimeCache:relative.startsWith("game/cache/")});
}
// Compiled caches are only classified as regenerable when their corresponding
// source is present in this archive and remains byte-identical after execution.
const byName=new Map(checks.map(check=>[check.file,check]));
for(const check of checks){
  const source=check.file.endsWith(".rpyc")?check.file.slice(0,-1):check.file.replace(/\/__pycache__\/([^/]+)\.cpython-\d+(?:\.opt-\d+)?\.pyc$/,"/$1.py");
  if(source!==check.file&&byName.get(source)?.matches)check.runtimeCache=true;
}
const changed=checks.filter(check=>!check.matches&&!check.runtimeCache);
const report={archive:path.resolve(archiveArg),archiveSha256:hash(archive),directory,checkedFiles:checks.length,changedNonCacheFiles:changed,changedRuntimeCaches:checks.filter(check=>!check.matches&&check.runtimeCache).map(check=>check.file),files:checks};
await writeFile(path.resolve(reportArg),JSON.stringify(report,null,2));
console.log(JSON.stringify({checkedFiles:checks.length,changedNonCacheFiles:changed.length,changedRuntimeCaches:report.changedRuntimeCaches.length}));
if(changed.length)process.exitCode=1;
