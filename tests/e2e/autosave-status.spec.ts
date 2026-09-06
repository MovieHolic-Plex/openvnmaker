import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
declare global {interface Window {qaLibraryFailure:boolean;qaRepositorySaved:Promise<string>;}}

test("library failures never report saved, and retry commits the latest manuscript",async({page},info)=>{
  await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(()=>{
    const original=indexedDB.open.bind(indexedDB);
    Object.defineProperty(window,"qaLibraryFailure",{value:true,writable:true});
    indexedDB.open=(name,version)=>{if(name==="vnmaker.projects"&&window.qaLibraryFailure)throw new DOMException("test failure","QuotaExceededError");return original(name,version);};
  });
  const status=page.getByTestId("studio-save-state");
  await page.getByLabel("작품 제목").fill("저장 실패 뒤의 최신 원고");
  await expect(status).toHaveText("저장 중…");
  await expect(status).toHaveText("저장 확인 필요");
  await expect(page.getByRole("alert")).toContainText("작품 보관함 저장에 실패");
  const admission=await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    return projectRepository.current().flushCurrent().then(()=>"acknowledged",(error:Error)=>error.name);
  });
  expect(admission).toBe("QuotaExceededError");
  await page.screenshot({path:info.outputPath("library-failure.png")});
  await page.evaluate(()=>{window.qaLibraryFailure=false;});
  await page.getByRole("button",{name:"다시 저장",exact:true}).click();
  await expect(status).toHaveText("로컬 저장됨");
  const title=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("vnmaker.projects",2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{return await new Promise<string>((resolve,reject)=>{const r=db.transaction("projects").objectStore("projects").get(localStorage.getItem("vnmaker.studio.active-project.v1")||"original-project");r.onsuccess=()=>resolve(r.result.script.title);r.onerror=()=>reject(r.error);});}finally{db.close();}
  });
  expect(title).toBe("저장 실패 뒤의 최신 원고");
});

test("recovery storage failure remains visible even when library saving succeeds",async({page},info)=>{
  await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const repository=projectRepository.current();
    window.qaRepositorySaved=new Promise(resolve=>{
      let began=false;
      const unsubscribe=repository.subscribe(()=>{began ||= repository.dirty;if(began&&!repository.dirty){unsubscribe();resolve(repository.snapshot.script.title);}});
    });
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==="vnmaker.studio.project.v1")throw new DOMException("test quota","QuotaExceededError");return original.call(this,key,value);};
  });
  await page.getByLabel("작품 제목").fill("복구 저장 실패 원고");
  await expect(page.getByRole("alert")).toContainText("빠른 복구 저장에 실패");
  // Subscription was installed before the edit; the bounded Playwright test awaits commit completion.
  expect(await page.evaluate(()=>window.qaRepositorySaved)).toBe("복구 저장 실패 원고");
  await expect(page.getByTestId("studio-save-state")).toHaveText("저장 확인 필요");
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath("recovery-failure-mobile.png")});
  const download=page.waitForEvent("download");await page.getByTestId("studio-export").click();
  await (await download).saveAs(info.outputPath("recovery.json"));
  expect(JSON.parse(await readFile(info.outputPath("recovery.json"),"utf8")).title).toBe("복구 저장 실패 원고");
});
