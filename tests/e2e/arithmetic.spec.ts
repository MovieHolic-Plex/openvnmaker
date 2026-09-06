import {test,expect} from "@playwright/test";
import {mkdir,readFile} from "node:fs/promises";
import {createServer} from "node:http";
import {unzipSync} from "../../packages/app/node_modules/fflate/esm/index.mjs";
import {arithmeticStory} from "../../packages/app/test/fixtures/arithmetic-story.js";
import {EDITION} from "../../packages/app/src/storage/edition.js";
test("authors a cumulative numeric choice, preserves it in ZIP and gates both played routes",async({page})=>{
  const {add,...choice}=arithmeticStory.scenes[0]!.choices![0]!;const story={...arithmeticStory,scenes:arithmeticStory.scenes.map((scene,index)=>index===0?{...scene,choices:[{...choice,set:{trust:3}},scene.choices![1]!]}:scene)};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("arithmetic-seed"))return;localStorage.setItem("arithmetic-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:1000});await mkdir("evidence/arithmetic",{recursive:true});await page.goto("/studio.html");await page.getByTestId("studio-scene-start").click();
  await page.locator(".choice-edit").first().getByText("선택 결과",{exact:false}).click();await page.getByLabel("선택지 1 trust 연산").selectOption("add");await page.getByLabel("선택지 1 trust 결과",{exact:true}).fill("3");await page.getByLabel("선택지 1 trust 결과",{exact:true}).press("Tab");await page.screenshot({path:"evidence/arithmetic/editor.png"});
  await page.reload();await page.locator(".choice-edit").first().getByText("선택 결과",{exact:false}).click();await expect(page.getByLabel("선택지 1 trust 연산")).toHaveValue("add");await expect(page.getByLabel("선택지 1 trust 결과",{exact:true})).toHaveValue("3");
  for(const index of [0,1]){
    await page.getByTestId("studio-scene-start").click();await page.getByTestId("studio-play").click();
    for(const pick of [index,0]){await expect(page.locator(".next-mark")).toBeVisible();await page.getByTestId("advance-button").click();await page.getByTestId(`choice-${pick}`).click();}
    await expect(page.locator(".next-mark")).toBeVisible();await page.getByTestId("advance-button").click();await expect(page.getByTestId("choice-0")).toHaveCount(index===0?1:0);await expect(page.getByTestId("choice-1")).toBeVisible();await page.getByTestId("studio-return").click();
  }
  await page.getByTestId("studio-export-bundle").click();const download=page.waitForEvent("download");await page.getByTestId("export-bundle-build").click();await expect(page.getByTestId("export-bundle-success")).toBeVisible();await(await download).saveAs("evidence/arithmetic/game.zip");
  const files=unzipSync(new Uint8Array(await readFile("evidence/arithmetic/game.zip"))) as Record<string,Uint8Array>;const exported=JSON.parse(new TextDecoder().decode(files["project.json"]));expect(exported.scenes[0].choices[0].add).toEqual({trust:3});expect(exported.scenes[0].choices[0].set).toEqual({});
  const server=createServer((request,response)=>{const path=new URL(request.url??"/","http://localhost").pathname.slice(1)||"index.html";const bytes=files[path];if(!bytes){response.writeHead(404).end();return;}response.setHeader("Content-Type",path.endsWith(".html")?"text/html":path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"application/octet-stream");response.end(bytes);});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{const {port}=server.address() as {port:number};await page.goto(`http://127.0.0.1:${port}/`);await page.getByTestId("start-button").click();for(let step=0;step<2;step++){await expect(page.locator(".next-mark")).toBeVisible();await page.getByTestId("advance-button").click();await page.getByTestId("choice-0").click();}await expect(page.locator(".next-mark")).toBeVisible();await page.getByTestId("advance-button").click();await expect(page.getByTestId("choice-0")).toBeVisible();await page.screenshot({path:"evidence/arithmetic/standalone.png"});}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
