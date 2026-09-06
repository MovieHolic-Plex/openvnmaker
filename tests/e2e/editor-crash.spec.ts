import {test,expect,chromium} from "@playwright/test";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";

test("a renderer crash releases the editor lock and preserves completed manuscript and original media",async({page,context,browserName},info)=>{
  test.skip(browserName!=="chromium","Uses Chromium's deliberate renderer-crash command.");
  test.setTimeout(60000);
  await page.goto("/studio.html");
  await page.getByTestId("project-library").click();await page.getByLabel("새 작품 이름").fill("크래시 복구 검증 작품");await page.getByTestId("project-create").click();
  await page.getByTestId("workspace-assets").click();
  const sourcePath=resolve("packages/app/public/assets/art/rain-library.png");
  await page.getByTestId("art-import-files").setInputFiles(sourcePath);
  await expect(page.locator(".art-message")).toContainText("1개 원화를 가져왔습니다");await page.getByTestId("art-apply").click();
  await page.getByTestId("workspace-stage").click();await page.getByTestId("studio-line-text").fill("저장 완료 후 렌더러가 중단돼도 남아 있어야 하는 대사.");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const before=await page.evaluate(()=>({raw:localStorage.getItem("vnmaker.studio.project.v1")!,id:localStorage.getItem("vnmaker.studio.active-project.v1")!}));
  const source=await readFile(sourcePath),sha=createHash("sha256").update(source).digest("hex"),media=`/assets/user/${sha}.png`;
  const waiting=await context.newPage();await waiting.goto("/studio.html");await expect(waiting.getByRole("heading",{name:"다른 탭에서 편집 중입니다"})).toBeVisible();
  const session=await context.newCDPSession(page),crashed=page.waitForEvent("crash");
  // Crash only this test-owned renderer. Do not close the page until handoff is verified.
  const command=session.send("Page.crash").catch(()=>{});
  await crashed;
  await expect(waiting.getByLabel("작품 제목")).toHaveValue("크래시 복구 검증 작품");
  expect(page.isClosed()).toBe(false);
  expect(await waiting.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe(before.raw);
  await waiting.getByTestId("workspace-stage").click();
  await expect(waiting.getByTestId("studio-line-text")).toHaveValue("저장 완료 후 렌더러가 중단돼도 남아 있어야 하는 대사.");
  const actual=await waiting.evaluate(async url=>{const response=await fetch(url);if(!response.ok)throw new Error(`Media ${response.status}`);return [...new Uint8Array(await crypto.subtle.digest("SHA-256",await response.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,"0")).join("");},media);
  expect(actual).toBe(sha);
  await waiting.getByTestId("studio-play").click();await expect(waiting.getByTestId("dialogue-text")).toHaveText("저장 완료 후 렌더러가 중단돼도 남아 있어야 하는 대사.");
  await expect(waiting.getByTestId("bg-image")).toHaveAttribute("src",media);await waiting.screenshot({path:info.outputPath("recovered-play.png")});
  await waiting.getByTestId("studio-return").click();await waiting.reload();await expect(waiting.getByLabel("작품 제목")).toHaveValue("크래시 복구 검증 작품");
  await writeFile(info.outputPath("crash-verification.json"),JSON.stringify({version:1,kind:"Chromium renderer crash via Page.crash",crashObserved:true,handoffWithoutClosingCrashedPage:true,projectId:before.id,manuscriptSha256:createHash("sha256").update(before.raw).digest("hex"),mediaSha256:actual},null,2));
  await page.close();await command;
});

test("completed saves survive a browser-process crash and reopening an isolated persistent profile",async({},info)=>{
  test.setTimeout(90000);
  const profile=info.outputPath("synthetic-browser-profile"),url=`http://127.0.0.1:${process.env.VNMAKER_APP_PORT||5173}/studio.html`;
  const first=await chromium.launchPersistentContext(profile,{headless:true});
  let original:string;
  try{
    const page=first.pages()[0]!;await page.goto(url);await page.getByLabel("작품 제목").fill("브라우저 프로세스 복구 원고");
    await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
    original=(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1")))!;
    const cdp=await first.newCDPSession(page),closed=first.waitForEvent("close");
    // Browser.crash intentionally cannot send a protocol response after termination.
    // Observe context closure instead of awaiting that non-returning command.
    void cdp.send("Browser.crash").catch(()=>{});
    await closed;
  }finally{await first.close().catch(()=>{});}
  // Reopen only after the test-owned browser confirms termination. No process-name killing.
  const second=await chromium.launchPersistentContext(profile,{headless:true});
  try{
    const page=second.pages()[0]!;await page.goto(url);await expect(page.getByLabel("작품 제목")).toHaveValue("브라우저 프로세스 복구 원고");
    const recovery=page.getByRole("button",{name:"이 보관함 원고로 복구"});
    if(await recovery.count())await recovery.click();
    expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe(original!);
    await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
    await page.screenshot({path:info.outputPath("browser-process-recovered.png")});
    await writeFile(info.outputPath("browser-crash-verification.json"),JSON.stringify({version:1,kind:"Chromium browser-process crash via Browser.crash",contextCloseObserved:true,persistentProfileReopened:true,manuscriptSha256:createHash("sha256").update(original!).digest("hex")},null,2));
  }finally{await second.close();}
});
