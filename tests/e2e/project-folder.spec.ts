import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {wav} from "../../packages/app/test/fixtures/wav.js";
import {EDITION} from "../../packages/app/src/storage/edition.js";

test("folder backup commits original media, restores edits, and rejects changed files without switching",async({page})=>{
  page.setDefaultTimeout(15000);
  const bytes=wav(.3,440),voice=`/assets/user/${createHash("sha256").update(bytes).digest("hex")}.wav`;
  const story={title:"폴더에 보관한 작품",subtitle:"",start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"원본 대사입니다.",voice}],ending:"끝"}]};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("folder-seed"))return;localStorage.setItem("folder-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await page.goto("/studio.html");
  await page.evaluate(async({voice,bytes})=>{
    const storage=await import("/src/storage/projectAssets.ts");await storage.ensureAssetServer();await storage.storeAssets([{path:voice,blob:new Blob([new Uint8Array(bytes)],{type:"audio/wav"}),originalName:"voice.wav",createdAt:Date.now()}]);
    const root=await navigator.storage.getDirectory();const parent=await root.getDirectoryHandle("folder-qa",{create:true});
    (window as any).qaParent=parent;
    (window as any).showDirectoryPicker=async({mode}:{mode:string})=>{if(mode==="readwrite")return parent;for await(const entry of (parent as any).values())if(entry.kind==="directory")return entry;throw new Error("No saved folder");};
  },{voice,bytes:[...bytes]});
  await page.getByTestId("project-library").click();await page.getByRole("button",{name:"폴더에 백업",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"저장 완료"})).toBeVisible();
  const saved=await page.evaluate(async()=>{const parent=(window as any).qaParent;for await(const entry of parent.values()){const file=await(await entry.getFileHandle("vnmaker-project.json")).getFile();return JSON.parse(await file.text());}});
  expect(saved.script.title).toBe(story.title);expect(saved.files.find((entry:any)=>entry.path===voice.slice(1)).sha256).toBe(voice.split("/").at(-1)!.split(".")[0]);
  await mkdir("evidence/project-folder",{recursive:true});await page.setViewportSize({width:1280,height:720});await page.screenshot({path:"evidence/project-folder/saved-1280.png"});
  await page.getByLabel("작품 보관함 닫기").click();await page.getByTestId("studio-scene-s").click();await page.getByTestId("studio-line-text").fill("백업 후 변경한 대사");
  await page.getByTestId("project-library").click();await page.getByRole("button",{name:"폴더에서 가져오기",exact:true}).click();await expect(page.getByLabel("내 작품 보관함")).not.toBeVisible();await page.getByTestId("studio-scene-s").click();await expect(page.getByTestId("studio-line-text")).toHaveValue("원본 대사입니다.");
  const restored=await page.evaluate(async voice=>[...new Uint8Array(await(await fetch(voice)).arrayBuffer())],voice);expect(restored).toEqual([...bytes]);
  await page.evaluate(async voice=>{const folder=await (window as any).showDirectoryPicker({mode:"read"});const assets=await folder.getDirectoryHandle("assets");const user=await assets.getDirectoryHandle("user");const file=await user.getFileHandle(voice.split("/").at(-1));const writer=await file.createWritable();await writer.write("corrupt");await writer.close();},voice);
  await page.getByTestId("studio-line-text").fill("손상된 백업이 덮어쓰면 안 됩니다.");await page.getByTestId("project-library").click();await page.getByRole("button",{name:"폴더에서 가져오기",exact:true}).click();await expect(page.getByRole("alert")).toContainText("손상");await page.getByLabel("작품 보관함 닫기").click();await expect(page.getByTestId("studio-line-text")).toHaveValue("손상된 백업이 덮어쓰면 안 됩니다.");
});

test("a folder larger than 512 MiB is written, verified and restored",async({page})=>{
  test.setTimeout(180000);await page.goto("/studio.html");
  const result=await page.evaluate(async()=>{
    const {saveProjectFolder,openProjectFolder}=await import("/src/studio/projectFolder.ts");const {newProject}=await import("/src/studio/projects.ts");
    const hash=async(bytes:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
    // Nineteen different 15-minute mono PCM files: 547,200,836 original bytes.
    const pcm=(index:number)=>{const bytes=new Uint8Array(44+16000*900*2),view=new DataView(bytes.buffer);const text=(offset:number,value:string)=>bytes.set(new TextEncoder().encode(value),offset);text(0,"RIFF");view.setUint32(4,bytes.length-8,true);text(8,"WAVE");text(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,bytes.length-44,true);view.setInt16(44,index+1,true);return bytes;};
    const story=newProject("512MiB 초과 폴더"),indices=new Map<string,number>();story.audioAssets=[];
    for(let index=0;index<19;index++){const bytes=pcm(index),url=`/assets/user/${await hash(bytes.buffer)}.wav`;indices.set(url,index);story.audioAssets.push({id:`audio-${index}`,name:`PCM ${index}`,url,kind:"bgm",duration:900});}
    const parent=await(await navigator.storage.getDirectory()).getDirectoryHandle("large-folder-qa",{create:true});
    const name=await saveProjectFolder(parent,story,undefined,async(path:string,options:any)=>indices.has(path)?new Response(pcm(indices.get(path)!)):fetch(path,options));
    const folder=await parent.getDirectoryHandle(name),manifest=JSON.parse(await(await(await folder.getFileHandle("vnmaker-project.json")).getFile()).text());
    let total=0,verified=0;
    for(const entry of manifest.files){let dir=folder;const parts=entry.path.split("/");for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);const file=await(await dir.getFileHandle(parts.at(-1))).getFile();if(file.size!==entry.size||await hash(await file.arrayBuffer())!==entry.sha256)throw new Error(`Wrong disk bytes: ${entry.path}`);total+=file.size;verified++;}
    const restored=await openProjectFolder(folder);
    for(const asset of restored.audioAssets){const response=await fetch(asset.url);if(!response.ok||await hash(await response.arrayBuffer())!==asset.url.split("/").at(-1).split(".")[0])throw new Error("Restored audio differs");}
    await parent.removeEntry(name,{recursive:true});return {total,verified,restored:restored.audioAssets.length};
  });
  expect(result.total).toBeGreaterThan(512*1024*1024);expect(result.verified).toBe(23);expect(result.restored).toBe(19);
  console.log(`Large folder verified: ${result.total} bytes across ${result.verified} files; ${result.restored} audio files restored and served byte-identically`);
});

test("failed folder writes never create a completion manifest",async({page})=>{
  await page.goto("/studio.html");
  const result=await page.evaluate(async()=>{
    const {saveProjectFolder}=await import("/src/studio/projectFolder.ts");
    const {newProject}=await import("/src/studio/projects.ts");
    const root=await navigator.storage.getDirectory();const parent=await root.getDirectoryHandle("failed-folder-qa",{create:true});
    let child:any;
    const wrap=(dir:any):any=>({getDirectoryHandle:async(name:string,options:any)=>wrap(await dir.getDirectoryHandle(name,options)),getFileHandle:async()=>({createWritable:async()=>{throw new Error("Disk full (test)");}})});
    const target={getDirectoryHandle:async(name:string,options:any)=>{child=await parent.getDirectoryHandle(name,options);return wrap(child);}};
    let message="";try{await saveProjectFolder(target,newProject("중단된 저장"));}catch(error){message=String(error);}
    let committed=false;try{await child.getFileHandle("vnmaker-project.json");committed=true;}catch{}
    return {message,committed};
  });
  expect(result.message).toContain("Disk full");expect(result.committed).toBe(false);
});
