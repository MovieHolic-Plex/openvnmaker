import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { script, type VnScript } from "../../packages/content/src/index.js";
import { EDITION } from "../../packages/app/src/storage/edition.js";

const fixture:VnScript={...script,title:"저장과 선택 검증",start:"start",flags:{remembered:false},assets:script.assets,scenes:[
  {id:"start",chapter:"첫 선택",background:"title",backgroundUrl:"/assets/art/nocturne-atrium.png",lines:[{speaker:null,text:"이 장면을 읽고 둘 중 한 쪽을 선택합니다."}],choices:[{text:"기억을 남긴다",next:"merge",set:{remembered:true}},{text:"새로 시작한다",next:"merge",set:{remembered:false}}]},
  {id:"merge",chapter:"합류한 뒤",background:"title",backgroundUrl:"/assets/art/rain-library.png",lines:[{speaker:"seorin",text:"아까 남긴 선택을 기억해. 이 대사는 그 선택을 했을 때만 보여.",when:{all:["remembered"]}},{speaker:"seorin",text:"새로 시작하자고 했지. 여기는 다른 선택에서 보이는 대사야.",when:{none:["remembered"]}},{speaker:null,text:"두 사람은 같은 길 위에서 서로 다른 이야기를 이어 갔다."}],ending:"기록된 결말"}
]};

async function seedEditor(page:Page){await page.addInitScript(({story,edition})=>{if(localStorage.getItem("completion-seed"))return;localStorage.setItem("completion-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story:fixture,edition:EDITION});}
test.beforeEach(async({page})=>{await mkdir("evidence/completion",{recursive:true});await page.setViewportSize({width:1440,height:1000});});

test("autosave survives a closed tab, retains the choice phase, and two manual slots restore different choices",async({page,context})=>{
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("completion-seed"))return;localStorage.setItem("completion-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker:save",JSON.stringify({sceneId:"start",lineIndex:0,affection:0,savedAt:1,script:story}));},{story:fixture,edition:EDITION});
  await page.goto("/");await page.getByTestId("continue-button").click();await page.getByTestId("skip-button").click();
  await expect(page.getByTestId("choice-menu")).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker:auto")??"{}").phase)).toBe("choice");
  await page.getByTestId("save-button").click();await page.getByTestId("slot-save-0").click();
  await page.getByTestId("choice-0").click();await expect(page.getByTestId("dialogue-text")).toHaveText(fixture.scenes[1]!.lines[0]!.text);
  await page.getByTestId("save-button").click();await page.getByTestId("slot-save-1").click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker:auto")??"{}").flags?.remembered)).toBe(true);
  const origin=new URL(page.url()).origin;await page.close();const reopened=await context.newPage();await reopened.goto(origin);await reopened.getByTestId("continue-button").click();
  await expect(reopened.getByTestId("dialogue-text")).toHaveText(fixture.scenes[1]!.lines[0]!.text);expect(await reopened.evaluate(()=>window.__vn?.flags.remembered)).toBe(true);
  await reopened.getByTestId("load-button").click();await reopened.screenshot({path:"evidence/completion/save-slots.png"});await reopened.getByTestId("slot-load-0").click();
  await expect(reopened.getByTestId("choice-menu")).toBeVisible();await reopened.getByTestId("choice-1").click();await expect(reopened.getByTestId("dialogue-text")).toHaveText(fixture.scenes[1]!.lines[1]!.text);
  await reopened.getByTestId("load-button").click();await reopened.getByTestId("slot-load-1").click();await expect(reopened.getByTestId("dialogue-text")).toHaveText(fixture.scenes[1]!.lines[0]!.text);
});

test("editing resumes at the same dialogue, view and focus mode; scene operations can be undone",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.getByTestId("studio-scene-merge").click();await page.getByTestId("studio-line-2").click();await page.getByRole("button",{name:"집중 모드",exact:true}).click();await page.reload();
  await expect(page.getByTestId("studio-line-2")).toHaveClass(/is-selected/);await expect(page.locator(".studio")).toHaveClass(/studio-focus/);await page.getByRole("button",{name:"연출 편집",exact:true}).click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue(fixture.scenes[1]!.lines[2]!.text);
  await page.getByTestId("scene-duplicate").click();await expect(page.getByTestId("studio-scene-list").locator("li")).toHaveCount(3);const copiedId=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!);return s.scenes[2].id as string;});
  await page.getByRole("button",{name:"장면 목록에서 위로 이동"}).click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!).scenes[1].id)).toBe(copiedId);
  await page.getByTestId("scene-delete").click();await page.getByLabel("삭제 후 연결할 장면").selectOption("merge");await page.getByTestId("scene-delete-confirm").click();await expect(page.getByTestId("studio-scene-list").locator("li")).toHaveCount(2);
  await page.getByTestId("studio-undo").click();await expect(page.getByTestId("studio-scene-list").locator("li")).toHaveCount(3);
});

test("named versions survive reload and restoring a version preserves the replaced draft",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.getByTestId("workspace-stage").click();await page.getByTestId("studio-line-text").fill("버전 하나의 원고입니다.");
  await page.getByTestId("studio-versions").click();await page.getByLabel("버전 이름").fill("첫 편집");await page.getByTestId("version-save").click();await expect(page.getByTestId("version-row").filter({hasText:"첫 편집"})).toBeVisible();await page.getByLabel("버전 기록 닫기").click();
  await page.getByTestId("studio-line-text").fill("이 작업은 버전을 복원해도 백업으로 남아야 합니다.");await page.reload();await page.getByTestId("studio-versions").click();await page.getByTestId("version-row").filter({hasText:"첫 편집"}).getByRole("button",{name:"복원",exact:true}).click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue("버전 하나의 원고입니다.");await page.getByTestId("studio-versions").click();await expect(page.getByTestId("version-row").filter({hasText:"복원 직전 작업"})).toBeVisible();await page.screenshot({path:"evidence/completion/version-history.png"});
  await page.getByTestId("version-row").filter({hasText:"복원 직전 작업"}).getByRole("button",{name:"복원",exact:true}).click();await expect(page.getByTestId("studio-line-text")).toHaveValue("이 작업은 버전을 복원해도 백업으로 남아야 합니다.");
});

test("director can preview a remembered choice and assign actor exits, poses, camera and music per line",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.getByTestId("studio-scene-merge").click();
  await expect(page.locator(".conditional-preview-note")).toBeVisible();await page.locator(".preview-routes summary").click();await page.getByLabel("미리보기 선택 1").selectOption("0");await expect(page.locator(".conditional-preview-note")).toHaveCount(0);await page.locator(".preview-routes summary").click();
  await page.getByText("이 대사의 배우·카메라·음악",{exact:true}).click();await page.getByLabel("left 대사 배우").selectOption("seorin");await page.getByLabel("left 대사 포즈").selectOption("/assets/art/seorin-working.png");await page.getByLabel("대사 카메라",{exact:true}).selectOption("close");await page.getByLabel("대사 배경음악").selectOption("warm");
  await expect(page.getByTestId("studio-stage").getByTestId("sprite-left")).toHaveAttribute("data-src","/assets/art/seorin-working.png");await expect(page.getByTestId("studio-stage").locator(".stage-layers")).toHaveClass(/framing-close/);
  await page.getByTestId("studio-line-2").click();await page.getByLabel("left 대사 배우").selectOption("leave");await expect(page.getByTestId("studio-stage").getByTestId("sprite-left")).toHaveCount(0);
  await page.reload();await expect(page.getByTestId("studio-stage").getByTestId("sprite-left")).toHaveCount(0);
});

test("clearing preview choices and importing another manuscript resets route flags; null positions recover",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.evaluate(()=>localStorage.setItem("vnmaker.studio.position.v1","null"));await page.reload();
  await page.getByTestId("studio-scene-merge").click();await page.locator(".preview-routes summary").click();await page.getByLabel("미리보기 선택 1").selectOption("0");await expect(page.locator(".conditional-preview-note")).toHaveCount(0);
  await page.getByLabel("미리보기 선택 1").selectOption("-1");await expect(page.locator(".conditional-preview-note")).toBeVisible();await expect(page.getByLabel("미리보기 선택 1")).toHaveValue("-1");
  await page.getByLabel("미리보기 선택 1").selectOption("0");await page.reload();await page.locator(".preview-routes summary").click();await expect(page.getByLabel("미리보기 선택 1")).toHaveValue("0");
  await page.getByTestId("studio-import").setInputFiles({name:"new.vn.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({...fixture,title:"새 원고"}))});
  await expect(page.getByLabel("작품 제목")).toHaveValue("새 원고");await page.getByTestId("studio-scene-merge").click();await expect(page.locator(".conditional-preview-note")).toBeVisible();
});

test("a delayed import cannot overwrite a newer edit",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.getByTestId("workspace-stage").click();
  await page.evaluate(()=>{const original=File.prototype.text;File.prototype.text=async function(){await new Promise(resolve=>setTimeout(resolve,500));return original.call(this);};});
  await page.getByTestId("studio-import").setInputFiles({name:"slow.vn.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({...fixture,title:"뒤늦은 가져오기"}))});
  await page.getByTestId("studio-line-text").fill("가져오기를 기다리는 동안 새로 쓴 문장.");await expect(page.getByRole("status")).toContainText("덮어쓰기를 중단");
  await expect(page.getByLabel("작품 제목")).toHaveValue(fixture.title);await expect(page.getByTestId("studio-line-text")).toHaveValue("가져오기를 기다리는 동안 새로 쓴 문장.");
});

test("a slower earlier import cannot replace the newer imported manuscript or its success notice",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.getByTestId("workspace-stage").click();
  const earlier:VnScript={...fixture,title:"먼저 선택한 느린 원고",scenes:[{...fixture.scenes[0]!,lines:[{speaker:null,text:"늦게 끝난 이전 파일의 문장입니다."}]},...fixture.scenes.slice(1)]};
  const latest:VnScript={...fixture,title:"나중에 선택한 최신 원고",scenes:[{...fixture.scenes[0]!,lines:[{speaker:null,text:"최신 가져오기에서 유지되어야 하는 문장입니다."}]},...fixture.scenes.slice(1)]};
  await page.evaluate(()=>{
    const original=File.prototype.text;
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const state={started:false,returned:false,release};
    (window as Window & {__qaImportGate?:typeof state}).__qaImportGate=state;
    File.prototype.text=async function(){
      const text=await original.call(this);
      if(this.name==="earlier.vn.json"){state.started=true;await gate;state.returned=true;}
      return text;
    };
  });
  await page.getByTestId("studio-import").setInputFiles({name:"earlier.vn.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(earlier))});
  await expect.poll(()=>page.evaluate(()=>(window as Window & {__qaImportGate?:{started:boolean}}).__qaImportGate?.started)).toBe(true);
  await page.getByTestId("studio-import").setInputFiles({name:"latest.vn.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(latest))});
  await expect(page.getByLabel("작품 제목")).toHaveValue(latest.title);
  await expect(page.getByTestId("studio-line-text")).toHaveValue(latest.scenes[0]!.lines[0]!.text);
  await expect(page.getByRole("status")).toContainText("작품을 가져왔습니다");
  await page.evaluate(()=>(window as Window & {__qaImportGate?:{release:()=>void}}).__qaImportGate!.release());
  await expect.poll(()=>page.evaluate(()=>(window as Window & {__qaImportGate?:{returned:boolean}}).__qaImportGate?.returned)).toBe(true);
  // Let the rejected older import's promise continuation and any React update finish.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!))).toEqual(latest);
  await expect(page.getByLabel("작품 제목")).toHaveValue(latest.title);
  await expect(page.getByTestId("studio-line-text")).toHaveValue(latest.scenes[0]!.lines[0]!.text);
  await expect(page.getByRole("status")).toContainText("작품을 가져왔습니다");
  await page.getByTestId("studio-undo").click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!))).toEqual(fixture);
});

test("a pending version restore blocks closing and undo, then resets preview choices after its real backup completes",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.getByTestId("workspace-stage").click();
  const versionText="복원할 원고는 아직 선택을 하지 않은 상태입니다.";
  const currentText="복원을 기다리는 동안 유지되어야 할 현재 작업입니다.";
  await page.getByTestId("studio-line-text").fill(versionText);
  await page.getByTestId("studio-versions").click();await page.getByLabel("버전 이름").fill("대기 복원 대상");await page.getByTestId("version-save").click();
  await expect(page.getByTestId("version-row").filter({hasText:"대기 복원 대상"})).toBeVisible();await page.getByLabel("버전 기록 닫기").click();
  await page.getByTestId("studio-line-text").fill(currentText);
  await page.locator(".preview-routes summary").click();await page.getByLabel("미리보기 선택 1").selectOption("0");await page.locator(".preview-routes summary").click();
  const current=await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"));
  await page.getByTestId("studio-versions").click();
  const target=page.getByTestId("version-row").filter({hasText:"대기 복원 대상"});await expect(target).toBeVisible();
  // Hold a genuine readwrite transaction; the app's backup transaction must queue behind it.
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("vnmaker.project-history",1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,transaction=db.transaction("versions","readwrite"),store=transaction.objectStore("versions");
      let keepAlive=true;
      const completed=new Promise<void>((done,fail)=>{transaction.oncomplete=()=>{db.close();done();};transaction.onerror=()=>{db.close();fail(transaction.error);};});
      (window as Window & {__qaReleaseVersionLock?:()=>Promise<void>}).__qaReleaseVersionLock=()=>{keepAlive=false;return completed;};
      const pump=()=>{const read=store.get("__qa_absent_lock_key__");read.onsuccess=()=>{if(keepAlive)pump();};};
      pump();resolve();
    };
  }));
  try {
    await target.getByRole("button",{name:"복원",exact:true}).click();
    await expect(page.getByLabel("버전 기록 닫기")).toBeDisabled();
    await expect(target.getByRole("button",{name:"복원",exact:true})).toBeDisabled();
    await page.getByLabel("버전 기록 닫기").evaluate(button=>(button as HTMLButtonElement).click());
    await expect(page.getByRole("dialog",{name:"프로젝트 버전 기록"})).toBeVisible();
    await page.keyboard.press("Escape");await expect(page.getByRole("dialog",{name:"프로젝트 버전 기록"})).toBeVisible();
    await page.keyboard.press("Control+z");
    expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe(current);
    await expect(page.getByTestId("studio-line-text")).toHaveValue(currentText);
  } finally {
    await page.evaluate(()=>(window as Window & {__qaReleaseVersionLock?:()=>Promise<void>}).__qaReleaseVersionLock?.());
  }
  await expect(page.getByRole("dialog",{name:"프로젝트 버전 기록"})).not.toBeVisible();
  await expect(page.getByTestId("studio-line-text")).toHaveValue(versionText);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.position.v1")!).choices)).toEqual({});
  await page.getByTestId("studio-versions").click();
  await expect(page.getByTestId("version-row").filter({hasText:"복원 직전 작업"})).toBeVisible();
  await page.getByLabel("버전 기록 닫기").click();
  await page.getByTestId("studio-scene-merge").click();await page.locator(".preview-routes summary").click();
  await expect(page.getByLabel("미리보기 선택 1")).toHaveValue("-1");
  await expect(page.locator(".conditional-preview-note")).toBeVisible();
  await page.getByTestId("studio-play").click();
  await expect(page.getByTestId("dialogue-text")).toHaveText(fixture.scenes[1]!.lines[1]!.text);
  expect(await page.evaluate(()=>window.__vn?.flags)).toEqual({remembered:false});
});

test("art viewing hides dialogue, pauses auto advance and returns to the same line",async({page})=>{
  await seedEditor(page);await page.goto("/studio.html");await page.getByTestId("workspace-stage").click();await page.getByTestId("studio-art-view").click();await expect(page.getByTestId("studio-stage").getByTestId("dialogue-text")).toHaveCount(0);
  await page.getByTestId("studio-art-view").click();await expect(page.getByTestId("studio-stage").getByTestId("dialogue-text")).toHaveText(fixture.scenes[0]!.lines[0]!.text);
  await page.getByTestId("studio-play").click();await page.getByTestId("auto-button").click();await page.getByTestId("art-view-button").click();
  await expect(page.getByTestId("dialogue-text")).toHaveCount(0);await page.waitForTimeout(3000);expect(await page.evaluate(()=>window.__vn?.lineIndex)).toBe(0);expect(await page.evaluate(()=>window.__vn?.phase)).toBe("scene");
  await page.getByTestId("art-view-button").click();await expect(page.getByTestId("dialogue-text")).toBeVisible();await page.getByTestId("auto-button").click();expect(await page.evaluate(()=>window.__vn?.lineIndex)).toBe(0);
});

test("save quota failure is visible and leaves the previous slot intact",async({page})=>{
  await page.goto("/");await page.getByTestId("start-button").click();await page.getByTestId("save-button").click();await page.getByTestId("slot-save-0").click();const previous=await page.evaluate(()=>localStorage.getItem("vnmaker:slots"));
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key:string,value:string){if(key.startsWith("vnmaker:"))throw new DOMException("Full","QuotaExceededError");return original.call(this,key,value);};});
  await page.getByTestId("save-button").click();await page.getByTestId("slot-save-0").click();await expect(page.getByTestId("slot-picker").getByRole("alert")).toContainText("저장하지 못했습니다");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker:slots"))).toBe(previous);
});
