import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {EDITION} from "../../packages/app/src/storage/edition.js";
declare global {interface Window {qaStateCommitted:Promise<{trust:number;op:string;value:number}>;}}
test("authors typed state, choice effects and conditions; persists and plays only the allowed branch",async({page})=>{
  const story={title:"편지의 조건",subtitle:"",start:"start",characters:[],flags:{},scenes:[{id:"start",background:"title",lines:[{speaker:null,text:"편지를 발견했다."}],choices:[{text:"편지를 챙긴다",next:"gate"},{text:"두고 간다",next:"gate"}]},{id:"gate",background:"title",lines:[{speaker:null,text:"문 앞에 도착했다."}],choices:[{text:"편지를 보여준다",next:"secret"},{text:"돌아간다",next:"end"}]},{id:"secret",background:"title",lines:[{speaker:null,text:"문이 열린다."}],ending:"초대"},{id:"end",background:"title",lines:[{speaker:null,text:"집으로 돌아왔다."}],ending:"귀가"}]};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("state-seeded"))return;localStorage.setItem("state-seeded","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await mkdir("evidence/state-authoring",{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.goto("/studio.html");await page.getByTestId("studio-scene-start").click();
  await page.locator(".state-editor summary").click();await page.getByLabel("새 변수 이름").fill("trust");await page.getByLabel("새 변수 유형").selectOption("number");await page.getByRole("button",{name:"변수 추가",exact:true}).click();
  const first=page.locator(".choice-edit").nth(0);await first.getByText("선택 결과",{exact:false}).click();await page.getByLabel("선택지 1 결과 변수 추가").selectOption("trust");await page.getByLabel("선택지 1 trust 결과",{exact:true}).fill("3");await page.getByLabel("선택지 1 trust 결과",{exact:true}).press("Tab");
  await page.getByTestId("studio-scene-gate").click();await page.getByText("선택지 1 표시 조건",{exact:false}).click();await page.locator(".choice-edit").nth(0).getByRole("button",{name:"조건 추가",exact:true}).click();await page.getByLabel("선택지 1 표시 조건 조건 1 비교").selectOption("gte");await page.getByLabel("선택지 1 표시 조건 조건 1 값").fill("3");
  await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const repository=projectRepository.current();
    window.qaStateCommitted=new Promise(resolve=>{
      let began=false;
      const take=()=>{
        began||=repository.dirty;
        const script=repository.snapshot.script;
        const trust=script.scenes.find(scene=>scene.id==="start")?.choices?.[0]?.set?.trust;
        const rule=script.scenes.find(scene=>scene.id==="gate")?.choices?.[0]?.when?.compare?.[0];
        if(began&&!repository.dirty&&trust===3&&rule?.flag==="trust"&&rule.op==="gte"&&rule.value===3){unsubscribe();resolve({trust,op:rule.op,value:rule.value});}
      };
      const unsubscribe=repository.subscribe(take);
      take();
    });
  });
  await page.getByLabel("선택지 1 표시 조건 조건 1 값").press("Tab");
  await expect(page.getByLabel("trust 변수 삭제")).toBeDisabled();await page.screenshot({path:"evidence/state-authoring/conditions-desktop.png"});await page.setViewportSize({width:390,height:844});await page.getByLabel("선택지 1 표시 조건 조건 1 값").scrollIntoViewIfNeeded();await page.screenshot({path:"evidence/state-authoring/conditions-mobile.png"});await page.setViewportSize({width:1440,height:1000});
  // Subscription was installed before this condition value commit; await the durable snapshot, not a prior 로컬 저장됨 label.
  expect(await page.evaluate(()=>window.qaStateCommitted)).toEqual({trust:3,op:"gte",value:3});
  await page.reload();await expect(page.getByLabel("선택지 1 표시 조건 조건 1 값")).toHaveValue("3");
  await page.getByTestId("studio-scene-start").click();await page.getByTestId("studio-play").click();await expect(page.locator(".next-mark")).toBeVisible();await page.getByRole("button",{name:"다음",exact:true}).click();await expect(page.getByTestId("choice-1")).toBeVisible();await page.getByTestId("choice-1").click();await expect(page.locator(".next-mark")).toBeVisible();await page.getByRole("button",{name:"다음",exact:true}).click();await expect(page.getByTestId("choice-1")).toBeVisible();await expect(page.getByTestId("choice-0")).toHaveCount(0);await expect(page.getByTestId("choice-1")).toBeFocused();await page.screenshot({path:"evidence/state-authoring/locked-route.png"});await page.getByTestId("studio-return").click();
  await page.getByTestId("studio-scene-start").click();await page.getByTestId("studio-play").click();await expect(page.locator(".next-mark")).toBeVisible();await page.getByRole("button",{name:"다음",exact:true}).click();await page.getByTestId("choice-0").click();await expect(page.locator(".next-mark")).toBeVisible();await page.getByRole("button",{name:"다음",exact:true}).click();await expect(page.getByTestId("choice-0")).toBeVisible();await page.getByTestId("choice-0").click();await expect(page.getByTestId("dialogue-text")).toHaveText("문이 열린다.");
});
