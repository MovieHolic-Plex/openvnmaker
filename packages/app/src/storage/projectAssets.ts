/** User media is stored as binary data, never in localStorage or temporary blob URLs. */
export const ASSET_DATABASE = "vnmaker.project-assets";
export const ASSET_STORE = "files";
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export interface StoredAsset { path: string; blob: Blob; originalName: string; createdAt: number }

export function imageFormat(bytes: Uint8Array): { extension: string; mime: string } {
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte)) return {extension:"png",mime:"image/png"};
  if (bytes.length > 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return {extension:"jpg",mime:"image/jpeg"};
  const text = new TextDecoder();
  if (bytes.length > 12 && text.decode(bytes.slice(0,4))==="RIFF" && text.decode(bytes.slice(8,12))==="WEBP") return {extension:"webp",mime:"image/webp"};
  throw new Error("PNG, JPEG, WebP 이미지 파일을 선택하세요. 확장자만 바꾼 파일은 가져올 수 없습니다.");
}

export async function describeImage(file: Blob): Promise<{ path: string; blob: Blob }> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new Error("이미지는 파일당 40MB 이하로 가져올 수 있습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = imageFormat(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  const hash = [...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  return {path:`/assets/user/${hash}.${format.extension}`,blob:new Blob([bytes],{type:format.mime})};
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(ASSET_DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(ASSET_STORE,{keyPath:"path"});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error("다른 탭에서 사용 중인 파일 보관함을 닫고 다시 시도하세요."));
  });
}

/** One transaction makes a multiple-file import all-or-nothing. */
export async function storeAssets(assets: readonly StoredAsset[]): Promise<void> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(ASSET_STORE,"readwrite");
    for(const asset of assets) tx.objectStore(ASSET_STORE).put(asset);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onabort=tx.onerror=()=>{db.close();reject(new Error("파일을 보관하지 못했습니다. 브라우저 저장 공간을 확인하세요."));};
  });
}

let ready: Promise<void> | undefined;
export function ensureAssetServer(): Promise<void> {
  if(ready)return ready;
  ready=(async()=>{
    if(!("serviceWorker" in navigator))throw new Error("파일 가져오기는 localhost 또는 HTTPS 주소에서 사용할 수 있습니다.");
    const registration=await navigator.serviceWorker.register("/project-assets-sw.js",{scope:"/",updateViaCache:"none"});
    await registration.update();
    const worker=registration.installing??registration.waiting;
    if(worker&&worker.state!=="activated")await new Promise<void>((resolve,reject)=>{
      const check=()=>{if(worker.state==="activated"||worker.state==="redundant"){clearTimeout(timer);worker.removeEventListener("statechange",check);worker.state==="activated"?resolve():reject(new Error("파일 보관함 업데이트에 실패했습니다."));}};
      const timer=setTimeout(()=>{worker.removeEventListener("statechange",check);reject(new Error("파일 보관함 업데이트 시간이 초과됐습니다. 새로고침해 주세요."));},12000);
      worker.addEventListener("statechange",check);check();
    });
    const isControlled=()=>navigator.serviceWorker.controller?.scriptURL===new URL("/project-assets-sw.js",location.href).href;
    if(isControlled())return;
    await new Promise<void>((resolve,reject)=>{
      const finish=()=>{if(isControlled()){clearTimeout(timer);navigator.serviceWorker.removeEventListener("controllerchange",finish);resolve();}};
      const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener("controllerchange",finish);reject(new Error("파일 보관함을 연결하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요."));},12000);
      navigator.serviceWorker.addEventListener("controllerchange",finish);finish();
    });
  })().catch(error=>{ready=undefined;throw error;});
  return ready;
}

export async function importImages(files: readonly File[]): Promise<StoredAsset[]> {
  if(!files.length || files.length>50)throw new Error("한 번에 이미지 1~50개를 선택하세요.");
  if(files.reduce((sum,file)=>sum+file.size,0)>200*1024*1024)throw new Error("한 번에 가져오는 원화는 합계 200MB 이하여야 합니다.");
  await ensureAssetServer();
  const assets:StoredAsset[]=[];
  for(const file of files){
    const asset=await describeImage(file);
    const bitmap=await createImageBitmap(asset.blob).catch(()=>{throw new Error(`${file.name}: 이미지 데이터를 읽을 수 없습니다.`);});
    const pixels=bitmap.width*bitmap.height;bitmap.close();
    if(pixels>64_000_000)throw new Error(`${file.name}: 이미지 해상도는 6,400만 픽셀 이하여야 합니다.`);
    assets.push({...asset,originalName:file.name,createdAt:Date.now()});
  }
  await storeAssets(assets);
  return assets;
}

/** 보관함 파일을 지운다. 참조 여부는 호출자(assetCleanup)가 확인한다. */
export async function deleteAssets(paths: readonly string[]): Promise<void> {
  if(!paths.length)return;
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(ASSET_STORE,"readwrite");
    for(const path of paths) tx.objectStore(ASSET_STORE).delete(path);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onabort=tx.onerror=()=>{db.close();reject(new Error("보관함 파일을 지우지 못했습니다."));};
  });
}
export async function listAssetPaths(): Promise<string[]> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(ASSET_STORE,"readonly"),request=tx.objectStore(ASSET_STORE).getAllKeys();
    tx.oncomplete=()=>{db.close();resolve(request.result.map(String));};
    tx.onabort=tx.onerror=()=>{db.close();reject(tx.error??new Error("보관함 파일 목록을 읽지 못했습니다."));};
  });
}
