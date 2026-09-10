import {test,expect,type Page} from "@playwright/test";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {unzipSync} from "../../packages/app/node_modules/fflate/esm/index.mjs";
import {arithmeticStory} from "../../packages/app/test/fixtures/arithmetic-story.js";
import {EDITION} from "../../packages/app/src/storage/edition.js";
import type {} from "../../packages/app/src/App.js";

type ArithmeticMatch = { readonly exact: string } | { readonly prefix: string };
declare global {interface Window {
  qaArithmeticCommitted:Promise<{add:Record<string,unknown>;set:Record<string,unknown>}>;
  __arithmeticWaiters?:Array<(text:string)=>void>;
  __arithmeticArmed?:Promise<void>;
  __arithmeticStartDeadline?:()=>void;
}}
const expectMs=15_000;

async function observeNextDurableChoice(page:Page){
  await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const repository=projectRepository.current();
    window.qaArithmeticCommitted=new Promise(resolve=>{
      let began=false;
      const unsubscribe=repository.subscribe(()=>{
        began ||= repository.dirty;
        if(began&&!repository.dirty){
          unsubscribe();
          const choice=repository.snapshot.script.scenes[0]?.choices?.[0];
          resolve({add:choice?.add??{},set:choice?.set??{}});
        }
      });
    });
  });
}

async function observeArithmeticPlayer(page:Page){
  await page.addInitScript(()=>{
    const waiters:NonNullable<Window["__arithmeticWaiters"]>=[];
    window.__arithmeticWaiters=waiters;
    let state:Window["__vn"];
    Object.defineProperty(window,"__vn",{
      configurable:true,get:()=>state,
      set:(value:NonNullable<Window["__vn"]>)=>{
        state=value;
        const text=`arithmetic:state:${value.phase}:${value.sceneId}:${value.lineIndex}:${value.typing}`;
        for(const waiter of waiters.slice()) waiter(text);
      },
    });
  });
}

async function armArithmetic(page:Page,match:ArithmeticMatch|readonly ArithmeticMatch[]){
  const matches=(Array.isArray(match)?match:[match]).map(item=>"exact" in item?{exact:item.exact}:{prefix:item.prefix});
  await page.evaluate(({matches,ms})=>{
    const waiters=window.__arithmeticWaiters;
    if(!waiters) throw new Error("arithmetic observer was not installed");
    window.__arithmeticArmed=new Promise<void>((resolve,reject)=>{
      let timeout:number|undefined;
      let deadlineStarted=false;
      let settled=false;
      const pending=new Set(matches.map((_,index)=>index));
      const finish=(error?:Error)=>{
        if(settled) return;
        settled=true;
        if(timeout!==undefined) window.clearTimeout(timeout);
        const waiterIndex=waiters.indexOf(check);
        if(waiterIndex>=0) waiters.splice(waiterIndex,1);
        if(error) reject(error);
        else resolve();
      };
      function check(text:string){
        matches.forEach((item,index)=>{
          if(!pending.has(index)) return;
          const hit=typeof item.exact==="string"?text===item.exact:typeof item.prefix==="string"&&text.startsWith(item.prefix);
          if(hit) pending.delete(index);
        });
        if(pending.size===0) finish();
      }
      window.__arithmeticStartDeadline=()=>{
        if(settled||deadlineStarted) return;
        deadlineStarted=true;
        timeout=window.setTimeout(()=>finish(new Error("Timeout 15000ms exceeded while waiting for event \"console\"")),ms);
      };
      waiters.push(check);
    });
  },{matches,ms:expectMs});
}

async function awaitArithmetic(page:Page){
  await page.evaluate(()=>{
    const armed=window.__arithmeticArmed;
    if(!armed) throw new Error("arithmetic observer was not armed");
    window.__arithmeticStartDeadline?.();
    return armed;
  });
}

async function clickTo(page:Page,button:string,match:ArithmeticMatch|readonly ArithmeticMatch[]){
  await armArithmetic(page,match);
  await page.getByTestId(button).click();
  await awaitArithmetic(page);
}

test("authors a cumulative numeric choice, preserves it in ZIP and gates both played routes",async({page})=>{
  const {add,...choice}=arithmeticStory.scenes[0]!.choices![0]!;const story={...arithmeticStory,scenes:arithmeticStory.scenes.map((scene,index)=>index===0?{...scene,choices:[{...choice,set:{trust:3}},scene.choices![1]!]}:scene)};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("arithmetic-seed"))return;localStorage.setItem("arithmetic-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:1000});await mkdir("evidence/arithmetic",{recursive:true});await page.goto("/studio.html");await page.getByTestId("studio-scene-start").click();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.locator(".choice-edit").first().getByText("선택 결과",{exact:false}).click();
  await observeNextDurableChoice(page);
  await page.getByLabel("선택지 1 trust 연산").selectOption("add");await page.getByLabel("선택지 1 trust 결과",{exact:true}).fill("3");await page.getByLabel("선택지 1 trust 결과",{exact:true}).press("Tab");
  expect(await page.evaluate(()=>window.qaArithmeticCommitted)).toEqual({add:{trust:3},set:{}});
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.screenshot({path:"evidence/arithmetic/editor.png"});
  await page.reload();await page.locator(".choice-edit").first().getByText("선택 결과",{exact:false}).click();await expect(page.getByLabel("선택지 1 trust 연산")).toHaveValue("add");await expect(page.getByLabel("선택지 1 trust 결과",{exact:true})).toHaveValue("3");
  for(const index of [0,1]){
    await page.getByTestId("studio-scene-start").click();await page.getByTestId("studio-play").click();
    for(const pick of [index,0]){await expect(page.locator(".next-mark")).toBeVisible();await page.getByTestId("advance-button").click();await page.getByTestId(`choice-${pick}`).click();}
    await expect(page.locator(".next-mark")).toBeVisible();await page.getByTestId("advance-button").click();await expect(page.getByTestId("choice-0")).toHaveCount(index===0?1:0);await expect(page.getByTestId("choice-1")).toBeVisible();await page.getByTestId("studio-return").click();
  }
  await page.getByTestId("studio-export-bundle").click();const download=page.waitForEvent("download");await page.getByTestId("export-bundle-build").click();await expect(page.getByTestId("export-bundle-success")).toBeVisible();await(await download).saveAs("evidence/arithmetic/game.zip");
  const files=unzipSync(new Uint8Array(await readFile("evidence/arithmetic/game.zip"))) as Record<string,Uint8Array>;const exported=JSON.parse(new TextDecoder().decode(files["project.json"]));expect(exported.scenes[0].choices[0].add).toEqual({trust:3});expect(exported.scenes[0].choices[0].set).toEqual({});
  await observeArithmeticPlayer(page);
  const server=createServer((request,response)=>{const path=new URL(request.url??"/","http://localhost").pathname.slice(1)||"index.html";const bytes=files[path];if(!bytes){response.writeHead(404).end();return;}response.setHeader("Content-Type",path.endsWith(".html")?"text/html":path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"application/octet-stream");response.end(bytes);});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const {port}=server.address() as {port:number};
    await page.goto(`http://127.0.0.1:${port}/`);
    await clickTo(page,"start-button",{exact:"arithmetic:state:scene:start:0:false"});
    await expect(page.locator(".next-mark")).toBeVisible();
    for(const scene of ["cost","gate"] as const){
      await clickTo(page,"advance-button",{exact:`arithmetic:state:choice:${scene==="cost"?"start":"cost"}:0:false`});
      await clickTo(page,"choice-0",{exact:`arithmetic:state:scene:${scene}:0:false`});
      await expect(page.locator(".next-mark")).toBeVisible();
    }
    await clickTo(page,"advance-button",{exact:"arithmetic:state:choice:gate:0:false"});
    await expect(page.getByTestId("choice-0")).toBeVisible();
    await page.screenshot({path:"evidence/arithmetic/standalone.png"});
  }
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("reload restores this arithmetic add only after the edit is durably committed",async({page},info)=>{
  const {add,...choice}=arithmeticStory.scenes[0]!.choices![0]!;const story={...arithmeticStory,scenes:arithmeticStory.scenes.map((scene,index)=>index===0?{...scene,choices:[{...choice,set:{trust:3}},scene.choices![1]!]}:scene)};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("arithmetic-seed"))return;localStorage.setItem("arithmetic-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:1000});await page.goto("/studio.html");await page.getByTestId("studio-scene-start").click();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.locator(".choice-edit").first().getByText("선택 결과",{exact:false}).click();
  await observeNextDurableChoice(page);
  await page.getByLabel("선택지 1 trust 연산").selectOption("add");await page.getByLabel("선택지 1 trust 결과",{exact:true}).fill("3");await page.getByLabel("선택지 1 trust 결과",{exact:true}).press("Tab");
  const committed=await page.evaluate(()=>window.qaArithmeticCommitted);
  expect(committed).toEqual({add:{trust:3},set:{}});
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await writeFile(info.outputPath("durable-arithmetic-commit.json"),JSON.stringify(committed));
  await page.reload();await page.locator(".choice-edit").first().getByText("선택 결과",{exact:false}).click();await expect(page.getByLabel("선택지 1 trust 연산")).toHaveValue("add");await expect(page.getByLabel("선택지 1 trust 결과",{exact:true})).toHaveValue("3");
});

test("arithmetic observer does not succeed without a published state",async({page})=>{
  test.setTimeout(30_000);
  const clockStart=new Date("2026-09-07T00:00:00Z");
  await page.clock.install({time:clockStart});
  await observeArithmeticPlayer(page);
  await page.goto("about:blank");
  await page.clock.pauseAt(new Date("2026-09-07T00:00:01Z"));
  await armArithmetic(page,{exact:"arithmetic:state:scene:gate:0:false"});
  const outcome=page.evaluate(()=>{
    if(!window.__arithmeticArmed) throw new Error("arithmetic observer was not armed");
    return window.__arithmeticArmed;
  }).then(()=>({status:"published" as const}),(error:unknown)=>({status:"rejected" as const,error}));
  await page.mouse.click(1,1);
  await page.evaluate(()=>{
    window.__vn={
      sceneId:"gate",
      lineIndex:0,
      affection:0,
      typing:true,
      phase:"scene",
      error:null,
      lastDiff:null,
      flags:{},
    };
  });
  const swallowing=awaitArithmetic(page).then(()=>undefined,()=>undefined);
  await page.clock.runFor(expectMs);
  await swallowing;
  const result=await outcome;
  expect(result.status).toBe("rejected");
  if(result.status!=="rejected") throw new Error("observer succeeded without a published gate typing-false state");
  expect(String(result.error)).toMatch(/Timeout 15000ms/);
});

test("arithmetic observer does not start the publication deadline before dispatch",async({page})=>{
  test.setTimeout(30_000);
  const deadlineSentinel="__arithmetic_deadline_registered";
  const clockStart=new Date("2026-09-07T00:00:00Z");
  await page.clock.install({time:clockStart});
  await observeArithmeticPlayer(page);
  await page.goto("about:blank");
  await page.clock.pauseAt(new Date("2026-09-07T00:00:01Z"));
  await page.evaluate(({ms,deadlineSentinel})=>{
    const original=window.setTimeout.bind(window);
    window.setTimeout=function(handler:TimerHandler,delay?:number,...rest:unknown[]){
      const id=original(handler,delay,...rest);
      if(delay===ms) console.log(deadlineSentinel);
      return id;
    } as typeof window.setTimeout;
  },{ms:expectMs,deadlineSentinel});
  const deadlineLogs:string[]=[];
  page.on("console",message=>{
    if(message.text()===deadlineSentinel) deadlineLogs.push(message.text());
  });
  await armArithmetic(page,{exact:"arithmetic:state:scene:gate:0:false"});
  expect(deadlineLogs).toEqual([]);
  const peek=()=>page.evaluate(async()=>{
    const armed=window.__arithmeticArmed;
    if(!armed) throw new Error("no armed waiter");
    let state:"pending"|"resolved"|"rejected"="pending";
    void armed.then(()=>{state="resolved";},()=>{state="rejected";});
    await Promise.resolve();
    return state;
  });
  await page.clock.runFor(expectMs);
  expect(await peek()).toBe("pending");
  const deadlineRegistered=page.waitForEvent("console",{
    timeout:expectMs,
    predicate:message=>message.text()===deadlineSentinel,
  });
  const outcome=awaitArithmetic(page).then(
    ()=>"resolved" as const,
    (error:unknown)=>error instanceof Error?error.message:String(error),
  );
  await deadlineRegistered;
  expect(await peek()).toBe("pending");
  await page.evaluate(()=>{
    window.__vn={
      sceneId:"gate",
      lineIndex:0,
      affection:0,
      typing:false,
      phase:"scene",
      error:null,
      lastDiff:null,
      flags:{trust:3},
    };
  });
  expect(await outcome).toBe("resolved");
  expect(await peek()).toBe("resolved");
});
