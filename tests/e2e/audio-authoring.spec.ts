import {test,expect} from "@playwright/test";
import {mkdir,readFile} from "node:fs/promises";
import {createServer} from "node:http";
import {unzipSync} from "../../packages/app/node_modules/fflate/esm/index.mjs";
import {wav} from "../../packages/app/test/fixtures/wav.js";
import {EDITION} from "../../packages/app/src/storage/edition.js";
test("original music, effects and voice survive authoring, ranges, ZIP and a clean-browser restore",async({page,browser})=>{
  const story={title:"내 음원으로 만든 작품",subtitle:"",start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"녹음이 끝날 때까지 기다립니다."},{speaker:null,text:"음악과 보이스가 멈췄습니다.",bgm:null}],ending:"확인"}]};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("audio-seeded"))return;localStorage.setItem("audio-seeded","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await mkdir("evidence/audio-authoring",{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.goto("/studio.html");await page.getByTestId("studio-scene-s").click();await page.locator(".audio-library summary").click();
  await page.getByLabel("작품 음악 페이드 (초)").fill("0.2");
  const originals={bgm:wav(8,110),sfx:wav(.2,440),voice:wav(4,220)};
  for(const kind of ["bgm","sfx","voice"] as const){await page.getByLabel("가져올 음원 종류").selectOption(kind);await page.getByTestId("audio-import-files").setInputFiles({name:`my-${kind}.wav`,mimeType:"audio/wav",buffer:Buffer.from(originals[kind])});await expect(page.locator(".audio-library article").filter({hasText:`my-${kind}.wav`})).toBeVisible();}
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const assets=await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!).audioAssets as {url:string;kind:"bgm"|"sfx"|"voice"}[]);
  const url=(kind:string)=>assets.find(asset=>asset.kind===kind)!.url;
  await page.getByLabel("장면 배경음악",{exact:true}).selectOption(url("bgm"));await page.getByLabel("대사 효과음",{exact:true}).selectOption(url("sfx"));await page.getByLabel("대사 보이스",{exact:true}).selectOption(url("voice"));await page.screenshot({path:"evidence/audio-authoring/library-desktop.png"});
  const range=await page.evaluate(async url=>{const response=await fetch(url,{headers:{Range:"bytes=44-63"}});return {status:response.status,range:response.headers.get("Content-Range"),bytes:[...new Uint8Array(await response.arrayBuffer())]};},url("voice"));expect(range.status).toBe(206);expect(range.bytes).toEqual([...originals.voice.slice(44,64)]);
  await page.reload();await expect(page.getByLabel("대사 보이스")).toHaveValue(url("voice"));await page.getByTestId("studio-play").click();await page.getByTestId("auto-button").click();
  await expect.poll(()=>page.getByTestId("voice-audio").evaluate((el:HTMLAudioElement)=>el.currentTime)).toBeGreaterThan(3.2);await expect(page.getByTestId("dialogue-text")).toHaveText(story.scenes[0]!.lines[0]!.text);await expect(page.getByTestId("bgm-audio")).toHaveAttribute("src",url("bgm"));
  await page.getByTestId("auto-button").click();await page.getByTestId("advance-button").click();await expect(page.getByTestId("dialogue-text")).toHaveText(story.scenes[0]!.lines[1]!.text);await expect.poll(()=>page.getByTestId("voice-audio").evaluate((el:HTMLAudioElement)=>el.paused)).toBe(true);await expect.poll(()=>page.locator("audio[data-testid^=bgm-audio]").evaluateAll((els:HTMLAudioElement[])=>els.every(el=>el.paused))).toBe(true);
  await page.getByTestId("studio-return").click();await page.getByTestId("studio-export-bundle").click();const download=page.waitForEvent("download");await page.getByTestId("export-bundle-build").click();await expect(page.getByTestId("export-bundle-success")).toBeVisible();await (await download).saveAs("evidence/audio-authoring/project-game.zip");
  const files=unzipSync(new Uint8Array(await readFile("evidence/audio-authoring/project-game.zip"))) as Record<string,Uint8Array>;
  for(const asset of assets)expect(Buffer.from(files[asset.url.slice(1)]!)).toEqual(Buffer.from(originals[asset.kind]));
  const fresh=await browser.newContext({baseURL:new URL(page.url()).origin});try{const restored=await fresh.newPage();restored.setDefaultTimeout(15000);await restored.goto("/studio.html");await restored.getByTestId("project-library").click();await restored.getByTestId("project-restore-file").setInputFiles("evidence/audio-authoring/project-game.zip");await expect(restored.getByLabel("작품 제목")).toHaveValue(story.title);await restored.getByTestId("studio-scene-s").click();await expect(restored.getByLabel("대사 보이스")).toHaveValue(url("voice"));expect(await restored.evaluate(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(10000)});await response.arrayBuffer();return response.status;},url("voice"))).toBe(200);await restored.screenshot({path:"evidence/audio-authoring/restored-1280.png"});await restored.goto("about:blank");}finally{await fresh.close();}
  const server=createServer((request,response)=>{const key=new URL(request.url??"/","http://localhost").pathname.slice(1)||"index.html";const bytes=files[key];if(!bytes){response.writeHead(404).end();return;}response.setHeader("Content-Type",key.endsWith(".html")?"text/html":key.endsWith(".js")?"text/javascript":key.endsWith(".css")?"text/css":key.endsWith(".wav")?"audio/wav":"application/octet-stream");response.end(bytes);});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{const address=server.address() as {port:number};await page.goto(`http://127.0.0.1:${address.port}/`);await page.getByTestId("start-button").click();await expect.poll(()=>page.getByTestId("voice-audio").evaluate((el:HTMLAudioElement)=>el.currentTime)).toBeGreaterThan(.2);await expect(page.getByTestId("bgm-audio")).toHaveAttribute("src",url("bgm"));await page.getByTestId("auto-button").click();await expect(page.getByTestId("dialogue-text")).toHaveText(story.scenes[0]!.lines[1]!.text);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("MP3 and Ogg imports decode; a corrupt batch does not register any audio",async({page})=>{
  await page.goto("/studio.html");await page.getByTestId("studio-scene-list").locator("button").first().click();await page.locator(".audio-library summary").click();
  await page.getByTestId("audio-import-files").setInputFiles(["packages/app/test/fixtures/audio-tone.mp3","packages/app/test/fixtures/audio-tone.ogg"]);
  await expect(page.locator(".audio-library article")).toHaveCount(2);
  const before=await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"));
  await page.getByTestId("audio-import-files").setInputFiles([{name:"valid.wav",mimeType:"audio/wav",buffer:Buffer.from(wav())},{name:"bad.wav",mimeType:"audio/wav",buffer:Buffer.from("invalid file")}]);
  await expect(page.locator(".audio-library [role=alert]")).toBeVisible();await expect(page.locator(".audio-library article")).toHaveCount(2);expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe(before);
});
