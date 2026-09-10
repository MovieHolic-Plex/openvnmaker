import { unzip } from "fflate";
import { characterExpressions, characterImage, parseScript, type VnScript } from "@vnmaker/content";
import { collectProjectAssets, rebaseProjectAssets } from "./exportBundle.js";
import { describeImage, ensureAssetServer, storeAssets, type StoredAsset } from "../storage/projectAssets.js";
import {crc32} from "./zip.js";
import {describeAudio,probeAudio} from "../storage/projectAudio.js";

const MAX_BYTES = 512 * 1024 * 1024;
const safePath = (path: string) => !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every(part => part !== "." && part !== "..");
const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map(byte => byte.toString(16).padStart(2,"0")).join("");

/** Extract data only. HTML, scripts and executable files in a game ZIP are never loaded. */
export async function readProjectBundle(file: Blob): Promise<{ script: VnScript; files: Record<string, Uint8Array> }> {
  if (!file.size || file.size > MAX_BYTES) throw new Error("작품 ZIP은 512MB 이하로 가져올 수 있습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  while (end >= Math.max(0,bytes.length-65557) && view.getUint32(end,true) !== 0x06054b50) end--;
  if (end < 0 || end < bytes.length-65557 || end+22+view.getUint16(end+20,true) !== bytes.length || view.getUint16(end+4,true) || view.getUint16(end+6,true)) throw new Error("지원하지 않거나 손상된 ZIP입니다.");
  const expected = new Map<string,{crc:number;size:number}>();
  const count = view.getUint16(end+10,true);
  let cursor = view.getUint32(end+16,true);
  if (count > 12000 || count !== view.getUint16(end+8,true)) throw new Error("ZIP 파일 개수 제한을 초과했습니다.");
  for (let index=0;index<count;index++) {
    if (cursor+46>end || view.getUint32(cursor,true)!==0x02014b50 || view.getUint16(cursor+8,true)&1) throw new Error("손상되거나 암호화된 ZIP입니다.");
    const length=view.getUint16(cursor+28,true), extra=view.getUint16(cursor+30,true), comment=view.getUint16(cursor+32,true);
    if(cursor+46+length+extra+comment>end) throw new Error("손상된 ZIP 파일 목록입니다.");
    const name=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+length));
    if(!safePath(name)||expected.has(name))throw new Error("중복되거나 안전하지 않은 ZIP 경로입니다.");
    expected.set(name,{crc:view.getUint32(cursor+16,true),size:view.getUint32(cursor+24,true)});
    cursor+=46+length+extra+comment;
  }
  if(cursor!==end)throw new Error("지원하지 않는 ZIP 파일 목록입니다.");
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let total = 0, count = 0;
    const names = new Set<string>();
    try {
      unzip(bytes, { filter(entry) {
        if (++count > 12000 || !safePath(entry.name) || names.has(entry.name)) throw new Error("중복되거나 안전하지 않은 ZIP 경로입니다.");
        names.add(entry.name);
        const wanted = entry.name === "project.json" || entry.name === "release.json" || /^assets\/.+\.(png|jpg|jpeg|webp|mp3|ogg|wav)$/i.test(entry.name);
        if (!wanted) return false;
        total += entry.originalSize;
        if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > 64 * 1024 * 1024 || total > MAX_BYTES || (entry.name === "project.json" || entry.name === "release.json") && entry.originalSize > 8 * 1024 * 1024) throw new Error("압축을 푼 작품의 크기 제한을 초과했습니다.");
        return true;
      } }, (error, result) => error ? reject(error) : resolve(result));
    } catch (error) { reject(error); }
  });
  for(const [path,data] of Object.entries(files)) {
    const entry=expected.get(path);
    if(!entry||entry.size!==data.length||entry.crc!==crc32(data))throw new Error(`ZIP 파일이 손상되었습니다: ${path}`);
  }
  if (!files["project.json"]) throw new Error("ZIP의 최상위 폴더에 project.json이 없습니다. 게임 ZIP을 선택하세요.");
  const script = parseScript(JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(files["project.json"])));
  for (const path of collectProjectAssets(script)) {
    const bytes=files[path.slice(1)];if(!bytes)throw new Error(`작품 파일이 빠져 있습니다: ${path}`);
    if(path.startsWith("/assets/user/")&&path.split("/").at(-1)!.split(".")[0]!==await hash(bytes))throw new Error(`원본 파일의 내용과 식별자가 다릅니다: ${path}`);
  }
  return {script, files};
}

/** Validate everything before one atomic media transaction; never overwrite built-in assets. */
export async function restoreProjectBundle(file: Blob, fetcher: typeof fetch = fetch): Promise<VnScript> {
  const {script, files} = await readProjectBundle(file);
  const assets: StoredAsset[] = [];
  const replacements = new Map<string,string>();
  for (const path of collectProjectAssets(script)) {
    const bytes = files[path.slice(1)]!;
    if (/\.(png|jpg|jpeg|webp)$/i.test(path)) {
      const asset = await describeImage(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      if (path.startsWith("/assets/user/") && asset.path !== path) throw new Error(`원화 파일의 내용과 식별자가 다릅니다: ${path}`);
      const bitmap = await createImageBitmap(asset.blob).catch(() => { throw new Error(`손상된 원화입니다: ${path}`); });
      const pixels = bitmap.width * bitmap.height; bitmap.close();
      if (pixels > 64_000_000) throw new Error(`원화 해상도 제한을 초과했습니다: ${path}`);
      assets.push({...asset, originalName:path.split("/").at(-1)!, createdAt:Date.now()});
      replacements.set(path,asset.path);
    } else if(path.startsWith("/assets/user/")){
      const asset=await describeAudio(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      if(asset.path!==path)throw new Error(`음원 파일의 내용과 식별자가 다릅니다: ${path}`);
      await probeAudio(asset.blob);assets.push({...asset,originalName:path.split("/").at(-1)!,createdAt:Date.now()});
    } else {
      // Legacy bundled media has fixed IDs. Fail explicitly if another editor version differs.
      const response = await fetcher(path, {cache:"no-store", redirect:"error"});
      if (!response.ok || await hash(new Uint8Array(await response.arrayBuffer())) !== await hash(bytes)) throw new Error(`이 에디터 버전과 기본 에셋이 다릅니다: ${path}. 원본과 같은 버전에서 복원하세요.`);
    }
  }
  const restored = rebaseProjectAssets({...script,
    characters:script.characters.map(actor=>({...actor,expressionImages:Object.fromEntries(characterExpressions(actor).flatMap(expression=>{const url=characterImage(actor,expression);return url?[[expression,url]]:[];}))})),
    scenes:script.scenes.map(scene=>({...scene,backgroundUrl:scene.backgroundUrl??`/assets/bg/${scene.background}.png`}))
  },replacements);
  if (assets.length) { await ensureAssetServer(); await storeAssets(assets); }
  return restored;
}
