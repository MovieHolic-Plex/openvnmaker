import {audioFormat} from "@vnmaker/content";
import {ensureAssetServer,storeAssets,type StoredAsset} from "./projectAssets.js";
export async function describeAudio(file:Blob){
  if(!file.size||file.size>50*1024*1024)throw new Error("음원은 파일당 50MB 이하여야 합니다.");
  const bytes=new Uint8Array(await file.arrayBuffer()),format=audioFormat(bytes);
  const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  return {path:`/assets/user/${hash}.${format.extension}`,blob:new Blob([bytes],{type:format.mime})};
}
export async function probeAudio(blob:Blob):Promise<number>{
  const url=URL.createObjectURL(blob),audio=new Audio();
  try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error("음원 정보를 읽는 시간이 초과됐습니다.")),15000);
    const finish=(error?:Error)=>{clearTimeout(timer);audio.onloadedmetadata=null;audio.onerror=null;if(error)reject(error);else if(!Number.isFinite(audio.duration)||audio.duration<=0||audio.duration>1800)reject(new Error("재생 가능한 30분 이하의 음원을 선택하세요."));else resolve(audio.duration);};
    audio.onloadedmetadata=()=>finish();audio.onerror=()=>finish(new Error("이 브라우저에서 재생할 수 없거나 손상된 음원입니다."));audio.preload="metadata";audio.src=url;
  });}finally{audio.removeAttribute("src");audio.load();URL.revokeObjectURL(url);}
}
export async function importAudio(files:readonly File[]):Promise<(StoredAsset&{duration:number})[]>{
  if(!files.length||files.length>50||files.reduce((sum,file)=>sum+file.size,0)>200*1024*1024)throw new Error("한 번에 1~50개, 합계 200MB 이하로 가져오세요.");
  const result=[];
  for(const file of files){const asset=await describeAudio(file);result.push({...asset,duration:await probeAudio(asset.blob),originalName:file.name,createdAt:Date.now()});}
  await ensureAssetServer();await storeAssets(result);return result;
}
