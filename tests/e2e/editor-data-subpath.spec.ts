/**
 * 배포 ZIP 을 도메인 루트가 아닌 하위 경로(예: /games/demo/)에 올렸을 때와, index.html 을 file:// 로 더블클릭했을 때.
 * 기존 export-bundle 스펙은 오리진 루트에서만 열었고, file:// 는 모듈 스크립트가 막혀 빈 화면만 나왔다.
 */
import {test,expect} from "@playwright/test";
import {createServer,type Server} from "node:http";
import {execFileSync} from "node:child_process";
import {mkdir,readFile,stat,writeFile} from "node:fs/promises";
import {extname,resolve,sep} from "node:path";

async function serve(directory:string,prefix:string):Promise<{server:Server;origin:string;missing:string[]}>{
  const missing:string[]=[];
  const server=createServer((request,response)=>{void(async()=>{
    const url=new URL(request.url??"/","http://localhost");
    if(!url.pathname.startsWith(prefix)){missing.push(url.pathname);response.writeHead(404).end();return;}
    const relative=url.pathname.slice(prefix.length)||"index.html";
    const path=resolve(directory,`./${decodeURIComponent(relative)}`);
    if(!path.startsWith(directory+sep)){response.writeHead(403).end();return;}
    try{await stat(path);const types:Record<string,string>={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".mp3":"audio/mpeg",".webp":"image/webp"};response.setHeader("Content-Type",types[extname(path)]??"application/octet-stream");response.setHeader("Cache-Control","no-store");response.end(await readFile(path));}
    catch{if(!url.pathname.endsWith("favicon.ico"))missing.push(url.pathname);response.writeHead(404).end("not found");}
  })().catch(()=>response.writeHead(500).end());});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address||typeof address==="string")throw new Error("Static server failed");
  return {server,origin:`http://127.0.0.1:${address.port}`,missing};
}

test("the exported game plays from a sub-path and index.html explains itself under file://",async({page,browser},info)=>{
  test.setTimeout(180_000);
  await page.goto("/studio.html");
  const zip=await page.evaluate(async()=>{
    const {newProject}=await import("/src/studio/projects.ts");const {buildExportBundle}=await import("/src/studio/exportBundle.ts");
    const script=newProject("하위 경로 배포 작품");const {blob}=await buildExportBundle(script);return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const zipPath=info.outputPath("subpath.zip");await writeFile(zipPath,Buffer.from(zip));
  const directory=info.outputPath("unpacked");await mkdir(directory,{recursive:true});
  if(process.platform==="win32")execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command","Expand-Archive -LiteralPath $env:VN_TEST_ZIP -DestinationPath $env:VN_TEST_OUTPUT -Force"],{env:{...process.env,VN_TEST_ZIP:zipPath,VN_TEST_OUTPUT:directory}});
  else execFileSync("unzip",["-q",zipPath,"-d",directory]);

  const hosting=await serve(directory,"/games/demo/");
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  try{
    const player=await context.newPage();const external:string[]=[],errors:string[]=[];
    player.on("request",request=>{const url=new URL(request.url());if(url.origin!==hosting.origin)external.push(url.href);});
    player.on("pageerror",error=>errors.push(error.message));
    await player.goto(`${hosting.origin}/games/demo/`);
    await expect(player.getByRole("heading",{name:"하위 경로 배포 작품",exact:true})).toBeVisible();
    await player.getByTestId("start-button").click();
    await expect(player.getByTestId("dialogue-text")).toHaveText("새로운 이야기가 시작됩니다.");
    await expect.poll(()=>player.evaluate(()=>{const image=document.querySelector('[data-testid="bg-image"]');return image instanceof HTMLImageElement?image.naturalWidth:-1;})).toBeGreaterThan(0);
    await player.screenshot({path:info.outputPath("subpath-play.png")});
    expect(hosting.missing).toEqual([]);expect(external).toEqual([]);expect(errors).toEqual([]);

    // file:// — 브라우저가 모듈 스크립트를 막아 플레이어는 실행되지 않는다. 고전 스크립트 안내가 대신 보여야 한다.
    const local=await context.newPage();
    await local.goto(`file://${resolve(directory,"index.html")}`);
    await expect(local.getByRole("heading",{name:"이 폴더를 정적 웹 서버에서 열어주세요"})).toBeVisible();
    await expect(local.locator("pre")).toContainText("python -m http.server 8080");
    await local.screenshot({path:info.outputPath("file-protocol-guidance.png")});
  }finally{await context.close();await new Promise<void>(resolve=>hosting.server.close(()=>resolve()));}
});
