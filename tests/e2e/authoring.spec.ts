import {test,expect} from "@playwright/test";
import {mkdir,readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";

test.beforeEach(async({page})=>{await page.setViewportSize({width:1440,height:1000});await mkdir("evidence/production-authoring",{recursive:true});});
test("new projects, arbitrary actors and uploaded originals survive reload, preview, switching and export",async({page,browser})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const api:string[]=[];page.on("request",request=>{const path=new URL(request.url()).pathname;if(path.startsWith("/api/")&&!/^\/api\/(store\/|auth\/status|image\/config|generate\/config)/.test(path))api.push(request.url());});
  await page.goto("/studio.html");await page.getByTestId("project-library").click();await page.getByLabel("새 작품 이름").fill("밤의 증인");await page.getByTestId("project-create").click();
  await expect(page.getByLabel("작품 제목")).toHaveValue("밤의 증인");await expect(page.getByTestId("studio-undo")).toBeDisabled();
  const firstId=await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!).scenes[0].lines[0].id);expect(firstId).toMatch(/^[a-zA-Z0-9-]+$/);

  await page.getByTestId("workspace-characters").click();
  for(const [id,name] of [["me","새 주인공"],["Detective_1","이서하"],["witness","목격자"],["rival","라이벌"]]){await page.getByLabel("새 캐릭터 ID").fill(id!);await page.getByLabel("새 캐릭터 이름").fill(name!);await page.getByTestId("character-add").click();}
  await expect(page.locator(".character-card")).toHaveCount(4);await page.getByLabel("Detective_1 녹색 배경 제거").check();
  await page.screenshot({path:"evidence/production-authoring/custom-cast-desktop.png"});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:"evidence/production-authoring/custom-cast-mobile.png"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByTestId("workspace-assets").click();await page.getByTestId("art-import-files").setInputFiles(path.resolve("packages/app/public/assets/art/rain-library.png"));
  await expect(page.locator(".art-message")).toContainText("1개 원화를 가져왔습니다");await page.getByTestId("art-apply").click();
  const source=await readFile("packages/app/public/assets/art/rain-library.png");const bg=`/assets/user/${createHash("sha256").update(source).digest("hex")}.png`;
  expect(await page.evaluate(async(url)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",await (await fetch(url)).arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,"0")).join(""),bg)).toEqual(createHash("sha256").update(source).digest("hex"));
  await page.getByLabel("가져올 원화 종류").selectOption("character");await page.getByLabel("가져올 원화 캐릭터").selectOption("Detective_1");await page.getByTestId("art-import-files").setInputFiles(path.resolve("packages/app/public/assets/art/seorin-neutral.png"));
  await expect(page.getByTestId("art-selected-preview")).toHaveAttribute("data-src",/\/assets\/user\//);await page.getByTestId("art-apply").click();
  await page.getByTestId("workspace-stage").click();await page.getByTestId("studio-line-text").fill("새로운 배우와 직접 가져온 원화로 만드는 장면입니다.");await page.getByLabel("화자",{exact:true}).selectOption("Detective_1");await page.getByText("이 대사의 배우·카메라·음악",{exact:true}).click();await page.getByLabel("left 대사 배우").selectOption("Detective_1");
  await expect(page.getByTestId("studio-stage").getByTestId("sprite-left")).toHaveAttribute("data-loaded","true");await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src",bg);
  await page.screenshot({path:"evidence/production-authoring/custom-project-editor.png"});
  // 원고는 600ms 디바운스 뒤 보관함(IndexedDB)에 비동기로 들어간다. 저장이 끝나기 전에 새로고침하면
  // 방금 지정한 배우가 사라진다 — 새로고침 내구성을 보는 단언이지 저장 경합을 보는 단언이 아니다.
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.reload();await expect(page.getByTestId("studio-stage").getByTestId("sprite-left")).toHaveAttribute("data-loaded","true");
  await page.getByTestId("studio-play").click();await expect(page.getByTestId("dialogue-text")).toHaveText("새로운 배우와 직접 가져온 원화로 만드는 장면입니다.");await expect(page.getByTestId("sprite-left")).toHaveAttribute("data-loaded","true");await page.getByTestId("studio-return").click();
  await page.getByTestId("project-library").click();await page.getByLabel("새 작품 이름").fill("다른 작품");await page.getByTestId("project-create").click();await page.getByTestId("project-library").click();await page.locator(".project-library article").filter({hasText:"밤의 증인"}).getByRole("button",{name:"열기",exact:true}).click();
  await expect(page.getByLabel("작품 제목")).toHaveValue("밤의 증인");await expect(page.getByTestId("studio-line-text")).toHaveValue("새로운 배우와 직접 가져온 원화로 만드는 장면입니다.");await expect(page.getByTestId("studio-undo")).toBeDisabled();
  await page.getByTestId("studio-export-bundle").click();const download=page.waitForEvent("download");await page.getByTestId("export-bundle-build").click();await (await download).saveAs("evidence/production-authoring/custom-project-game.zip");await expect(page.getByTestId("export-bundle-success")).toBeVisible();expect(errors).toEqual([]);expect(api).toEqual([]);
  const fresh=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:{width:1440,height:1000}});
  try {const restored=await fresh.newPage();await restored.goto("/studio.html");await restored.getByTestId("project-library").click();await restored.getByTestId("project-restore-file").setInputFiles(path.resolve("evidence/production-authoring/custom-project-game.zip"));await expect(restored.getByLabel("작품 제목")).toHaveValue("밤의 증인");expect(await restored.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!).scenes[0].lines[0].id)).toBe(firstId);await expect(restored.getByTestId("studio-stage").getByTestId("sprite-left")).toHaveAttribute("data-loaded","true");await expect(restored.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src",bg);await restored.reload();await expect(restored.getByTestId("studio-stage").getByTestId("sprite-left")).toHaveAttribute("data-loaded","true");await restored.screenshot({path:"evidence/production-authoring/restored-in-clean-browser.png"});}finally{await fresh.close();}
});

test("a non-image import cannot register artwork or modify the manuscript",async({page})=>{
  await page.goto("/studio.html");await page.getByTestId("workspace-assets").click();const before=await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"));
  await page.getByTestId("art-import-files").setInputFiles({name:"bad.png",mimeType:"image/png",buffer:Buffer.from("<html>fake image</html>")});await expect(page.locator(".art-import [role=alert]")).toContainText("PNG");expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe(before);
});

test("new dialogue identity survives undo, redo and reload without changing the previous line",async({page})=>{
  await page.goto("/studio.html");await page.getByTestId("project-library").click();await page.getByLabel("새 작품 이름").fill("대사 식별자 검증");await page.getByTestId("project-create").click();await expect(page.getByLabel("작품 제목")).toHaveValue("대사 식별자 검증");
  const ids=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!).scenes[0].lines.map((line:{id:string})=>line.id));
  const original=await ids();expect(original).toHaveLength(1);
  await page.getByTestId("studio-add-line").click();await expect.poll(async()=> (await ids()).length).toBe(2);const inserted=await ids();expect(inserted[0]).toBe(original[0]);expect(inserted[1]).not.toBe(original[0]);
  await page.getByTestId("studio-undo").click();await expect.poll(ids).toEqual(original);await page.getByRole("button",{name:"다시 실행",exact:true}).click();await expect.poll(ids).toEqual(inserted);
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.reload();await expect.poll(ids).toEqual(inserted);
});
