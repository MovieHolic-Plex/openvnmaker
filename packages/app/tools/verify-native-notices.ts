import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {unzipSync} from "fflate";

const [projectArg,archiveArg,reportArg,...extra]=process.argv.slice(2);
if(!projectArg||!archiveArg||!reportArg||extra.length)throw new Error("Usage: node --import tsx tools/verify-native-notices.ts <native-project> <pc.zip> <report.json>");
const required=["FONT-NOTICES.txt","VNMAKER-LICENSE.txt","LICENSE.txt","game/MEDIA_CREDITS.json","game/MEDIA_CREDITS.txt","game/fonts/SourceHanSansLite.ttf"];
const archive=await readFile(resolve(archiveArg));
const entries=unzipSync(archive,{filter:file=>required.some(path=>file.name.endsWith(`/${path}`))});
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const roots=new Set(Object.keys(entries).map(name=>name.split("/")[0]));
if(roots.size!==1)throw new Error("Expected one game root in the native archive");
const root=[...roots][0]!;
const files=[];
for(const path of required){
  const bytes=entries[`${root}/${path}`];if(!bytes)throw new Error(`Missing native distribution file: ${path}`);
  const original=await readFile(resolve(projectArg,path));
  if(sha(original)!==sha(bytes))throw new Error(`Native distribution file differs from project: ${path}`);
  files.push({path,bytes:bytes.length,sha256:sha(bytes)});
}
const fontHash=files.find(file=>file.path.endsWith(".ttf"))!.sha256;
if(!new TextDecoder().decode(entries[`${root}/FONT-NOTICES.txt`]).includes(fontHash))throw new Error("Font notice does not identify the shipped font bytes");
const report={version:1,scope:"Required media credits, source/SDK notices and Korean font in this native archive; not a complete dependency license audit.",archiveSha256:sha(archive),files};
await writeFile(resolve(reportArg),JSON.stringify(report,null,2));
console.log(`Verified ${files.length} native package files against project bytes, including the font notice hash.`);
