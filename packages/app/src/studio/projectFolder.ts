import {parseScript,type VnScript} from "@vnmaker/content";
import {collectProjectAssets,rebaseProjectAssets} from "./exportBundle.js";
import {bundlePathKind,rebaseRestoredScript} from "./restoreBundle.js";
import {describeImage,ensureAssetServer,storeAssets,type StoredAsset} from "../storage/projectAssets.js";
import {describeAudio,probeAudio} from "../storage/projectAudio.js";

export interface FolderHandle {
  getDirectoryHandle(name:string,options?:{create?:boolean}):Promise<FolderHandle>;
  removeEntry?(name:string,options?:{recursive?:boolean}):Promise<void>;
  getFileHandle(name:string,options?:{create?:boolean}):Promise<{
    getFile():Promise<File>;
    createWritable():Promise<{write(data:Blob|string):Promise<void>;close():Promise<void>;abort():Promise<void>}>;
  }>;
}
interface Entry {path:string;size:number;sha256:string}
interface Manifest {format:"vnmaker-folder";version:1;script:VnScript;files:Entry[]}
export interface FolderProgress {phase:"save"|"check"|"restore";complete:number;total:number}
type Progress=(value:FolderProgress)=>void;
const MAX_FILE=50*1024*1024;
const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,"0")).join("");
const safePath=(path:unknown):path is string=>typeof path==="string"&&/^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|mp3|ogg|wav)$/.test(path);
async function fileHandle(root:FolderHandle,path:string,create=false){
  if(!safePath(path))throw new Error("안전하지 않은 작품 파일 경로입니다.");
  const parts=path.split("/");let folder=root;
  for(const part of parts.slice(0,-1))folder=await folder.getDirectoryHandle(part,{create});
  return folder.getFileHandle(parts.at(-1)!,{create});
}
async function write(handle:Awaited<ReturnType<FolderHandle["getFileHandle"]>>,data:Blob|string){
  const writer=await handle.createWritable();try{await writer.write(data);await writer.close();}catch(error){await writer.abort().catch(()=>undefined);throw error;}
}
async function describe(path:string,blob:Blob,decode:boolean){
  const image=/\.(png|jpg|jpeg|webp)$/i.test(path);
  const asset=await(image?describeImage(blob):describeAudio(blob));
  const extension=asset.path.split(".").at(-1)!;
  if(!path.toLowerCase().endsWith(`.${extension}`)&&!(extension==="jpg"&&/\.jpeg$/i.test(path)))throw new Error(`파일 형식과 확장자가 다릅니다: ${path}`);
  if(path.startsWith("assets/user/")&&asset.path!==`/${path}`)throw new Error(`원본 파일의 식별자가 다릅니다: ${path}`);
  if(decode){
    if(image){const bitmap=await createImageBitmap(asset.blob);const pixels=bitmap.width*bitmap.height;bitmap.close();if(pixels>64_000_000)throw new Error(`이미지 해상도 제한 초과: ${path}`);}
    else await probeAudio(asset.blob);
  }
  return asset;
}

/** A fresh child directory is committed only after all original media has been written. */
export async function saveProjectFolder(root:FolderHandle,source:VnScript,onProgress?:Progress,fetcher:typeof fetch=fetch){
  const script=parseScript(structuredClone(source)),paths=collectProjectAssets(script);
  if(paths.length>12000)throw new Error("작품 파일은 12,000개까지 저장할 수 있습니다.");
  const name=`vnmaker-${new Date().toISOString().replace(/[:.]/g,"-")}-${crypto.randomUUID()}`;
  const folder=await root.getDirectoryHandle(name,{create:true}),files:Entry[]=[],replacements=new Map<string,string>();let complete=0;
  try{
    for(const path of paths){
      onProgress?.({phase:"save",complete:complete++,total:paths.length});
      let relative=path.slice(1);const generated=/^\/api\/image\/file\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(path);
      if(!safePath(relative)&&!generated)throw new Error(`지원하지 않는 작품 경로입니다: ${path}`);
      const response=await fetcher(path,{cache:"no-store",redirect:"error"});if(!response.ok)throw new Error(`파일을 읽지 못했습니다: ${path}`);
      if(Number(response.headers.get("Content-Length"))>MAX_FILE)throw new Error(`파일 크기 제한 초과: ${path}`);
      const blob=await response.blob();if(!blob.size||blob.size>MAX_FILE)throw new Error(`파일 크기 제한 초과: ${path}`);
      const asset=await describe(relative,blob,false);
      if(generated){relative=asset.path.slice(1);replacements.set(path,asset.path);}
      if(files.some(file=>file.path===relative))continue;
      const entry={path:relative,size:blob.size,sha256:await hash(blob)};
      await write(await fileHandle(folder,relative,true),blob);files.push(entry);
    }
    const manifest:Manifest={format:"vnmaker-folder",version:1,script:rebaseProjectAssets(script,replacements),files};
    const json=JSON.stringify(manifest,null,2);if(new Blob([json]).size>8*1024*1024)throw new Error("작품 목록과 원고는 8MB 이하여야 합니다.");
    await write(await folder.getFileHandle("vnmaker-project.json",{create:true}),json);
  }catch(error){
    // 중간 실패는 반쯤 쓰인 폴더를 남긴다 — 지원하는 한 지우고, 못 지우면 다음 저장이 새 이름을 쓰므로 덮이지 않는다.
    await root.removeEntry?.(name,{recursive:true}).catch(()=>undefined);
    throw error;
  }
  onProgress?.({phase:"save",complete:paths.length,total:paths.length});return name;
}

/** Validate the entire snapshot first, then copy one media file at a time. The caller activates last. */
export async function openProjectFolder(root:FolderHandle,onProgress?:Progress,fetcher:typeof fetch=fetch):Promise<VnScript>{
  const file=await(await root.getFileHandle("vnmaker-project.json")).getFile();
  if(file.size>8*1024*1024)throw new Error("작품 목록 크기 제한을 초과했습니다.");
  const raw=JSON.parse(await file.text()) as Manifest;
  if(raw.format!=="vnmaker-folder"||raw.version!==1||!Array.isArray(raw.files)||raw.files.length>12000)throw new Error("지원하지 않거나 미완료된 작품 폴더입니다.");
  const script=parseScript(raw.script),expected=new Set(collectProjectAssets(script).map(path=>path.slice(1))),seen=new Set<string>();
  for(const entry of raw.files){
    if(!entry||!safePath(entry.path)||seen.has(entry.path)||!expected.has(entry.path)||!Number.isSafeInteger(entry.size)||entry.size<=0||entry.size>MAX_FILE||typeof entry.sha256!=="string"||! /^[a-f0-9]{64}$/.test(entry.sha256))throw new Error("손상된 작품 파일 목록입니다.");
    seen.add(entry.path);
  }
  if(seen.size!==expected.size)throw new Error("작품에 필요한 파일이 목록에서 빠져 있습니다.");
  async function read(entry:Entry){const blob=await(await fileHandle(root,entry.path)).getFile();if(blob.size!==entry.size||await hash(blob)!==entry.sha256)throw new Error(`파일이 변경되거나 손상되었습니다: ${entry.path}`);return blob;}
  const replacements=new Map<string,string>(),unchanged=new Set<string>();let count=0;
  for(const entry of raw.files){
    onProgress?.({phase:"check",complete:count++,total:raw.files.length});
    const blob=await read(entry),asset=await describe(entry.path,blob,true);
    if(entry.path.startsWith("assets/audio/")){
      const response=await fetcher(`/${entry.path}`,{cache:"no-store",redirect:"error"});
      if(!response.ok||await hash(await response.blob())!==entry.sha256)throw new Error(`이 에디터 버전과 기본 음원이 다릅니다: ${entry.path}`);
      continue;
    }
    // 기본 이미지(배경·내장 스프라이트·컬렉션 아트)가 이 편집기에 그대로 있으면 복사본을 만들지 않고 원고도 그 주소를 유지한다.
    if(bundlePathKind(`/${entry.path}`)==="builtin"){
      try{const response=await fetcher(`/${entry.path}`,{cache:"no-store",redirect:"error"});if(response.ok&&await hash(await response.blob())===entry.sha256){unchanged.add(entry.path);continue;}}catch{/* 다른 판본 — 아래에서 들여온다. */}
    }
    if(asset.path!==`/${entry.path}`)replacements.set(`/${entry.path}`,asset.path);
  }
  const restored=rebaseRestoredScript(script,replacements);
  await ensureAssetServer();count=0;
  // 검증과 커밋을 분리한다 — 파일 단위로 저장하면 도중 실패가 반쪽짜리 보관함을 남긴다.
  const pending:StoredAsset[]=[];
  for(const entry of raw.files){
    onProgress?.({phase:"restore",complete:count++,total:raw.files.length});
    if(entry.path.startsWith("assets/audio/")||unchanged.has(entry.path))continue;
    // Recheck because external applications can change files between validation and copying.
    const asset=await describe(entry.path,await read(entry),false);
    pending.push({...asset,originalName:entry.path.split("/").at(-1)!,createdAt:Date.now()});
  }
  if(pending.length)await storeAssets(pending);
  onProgress?.({phase:"restore",complete:raw.files.length,total:raw.files.length});return restored;
}

export function folderPickerSupported(){return "showDirectoryPicker" in window;}
export function pickProjectFolder(mode:"read"|"readwrite"):Promise<FolderHandle>{
  return (window as unknown as {showDirectoryPicker:(options:{mode:"read"|"readwrite"})=>Promise<FolderHandle>}).showDirectoryPicker({mode});
}
