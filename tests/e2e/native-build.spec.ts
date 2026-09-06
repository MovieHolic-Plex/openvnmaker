import {test,expect} from "@playwright/test";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {unzipSync} from "../../packages/app/node_modules/fflate/esm/index.mjs";
import {EDITION} from "../../packages/app/src/storage/edition.js";
const headers={"X-VNMaker-Studio":"1"};
test("an active SDK build can be cancelled, remains cancelled after reload and releases the build slot",async({page})=>{
  test.setTimeout(120000);page.setDefaultTimeout(15000);
  const story={title:"취소 검증 작품",subtitle:"",start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"이 빌드는 취소합니다."}],ending:"끝"}]};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("cancel-seed"))return;localStorage.setItem("cancel-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await page.goto("/studio.html");await page.getByTestId("studio-native-build").click();await page.getByTestId("native-build-start").click();
  await expect(page.getByLabel("빌드 결과").locator("strong").first()).toHaveText("실행 게임 빌드",{timeout:60000});
  const id=await page.evaluate(()=>localStorage.getItem("vnmaker.native-build.last-job"));await page.getByTestId("native-build-cancel").click();
  const repeated=await Promise.all([1,2,3].map(()=>page.request.post(`/api/native-build/jobs/${id}/cancel`,{headers})));for(const response of repeated)expect([202,409]).toContain(response.status());
  await expect(page.getByLabel("빌드 결과")).toContainText("빌드 취소됨",{timeout:30000});await expect(page.getByTestId("native-build-download")).toHaveCount(0);
  expect((await page.request.get(`/api/native-build/jobs/${id}/artifact`)).status()).toBe(404);const capabilities=await(await page.request.get("/api/native-build/capabilities",{headers})).json();expect(capabilities.active).toBeUndefined();
  await page.reload();await page.getByTestId("studio-native-build").click();await expect(page.getByLabel("빌드 결과")).toContainText("빌드 취소됨");await expect(page.getByTestId("native-build-start")).toBeEnabled();
  expect((await page.request.post(`/api/native-build/jobs/${id}/cancel`,{headers})).status()).toBe(409);await mkdir("evidence/native-editor",{recursive:true});await page.screenshot({path:"evidence/native-editor/cancelled-1280.png"});
});
test("native build controls remain reachable at desktop and narrow widths",async({page})=>{
  page.setDefaultTimeout(15000);await mkdir("evidence/native-editor",{recursive:true});
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:820});await page.goto("/studio.html");
    const button=page.getByTestId("studio-native-build");await expect(button).toBeVisible();await button.click();
    const dialog=page.getByLabel("네이티브 게임 빌드");await expect(dialog).toBeVisible();const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({path:`evidence/native-editor/dialog-${width}.png`});await page.getByLabel("네이티브 빌드 창 닫기").click();
  }
});
test("native service rejects cross-origin requests and reports a corrupt upload as failed",async({request})=>{
  expect((await request.get("/api/native-build/capabilities")).status()).toBe(403);
  expect((await request.get("/api/native-build/capabilities",{headers:{...headers,Origin:"https://example.org"}})).status()).toBe(403);
  expect((await request.get("/api/native-build/capabilities",{headers:{...headers,Host:"attacker.example:5184"}})).status()).toBe(403);
  const capabilities=await(await request.get("/api/native-build/capabilities",{headers})).json();expect(capabilities.available).toBe(true);
  const response=await request.post("/api/native-build/jobs",{headers:{...headers,"Content-Type":"application/zip"},data:Buffer.from("invalid archive")});expect(response.status()).toBe(202);const {id}=await response.json();
  await expect.poll(async()=>(await(await request.get(`/api/native-build/jobs/${id}`,{headers})).json()).phase,{timeout:30000}).toBe("failed");
  const status=await(await request.get(`/api/native-build/jobs/${id}`,{headers})).json();expect(status.error).toContain("convert");expect(status.log).toContain("ZIP");expect((await request.get(`/api/native-build/jobs/${id}/artifact`)).status()).toBe(404);
});
test("the editor builds its current manuscript with the real SDK and downloads a native package",async({page})=>{
  test.setTimeout(240000);page.setDefaultTimeout(15000);
  const story={title:"에디터에서 빌드한 작품",subtitle:"",start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"에디터의 현재 원고로 만든 실행 게임입니다."},{speaker:null,text:"두 번째 대사도 원본 그대로입니다."}],ending:"빌드 확인"}]};
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("native-seeded"))return;localStorage.setItem("native-seeded","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await page.goto("/studio.html");await page.getByTestId("studio-native-build").click();await expect(page.getByTestId("native-build-start")).toBeEnabled();await page.getByTestId("native-build-start").click();
  await expect(page.getByLabel("빌드 결과")).toBeVisible();await page.getByLabel("네이티브 빌드 창 닫기").click();await page.reload();await page.getByTestId("studio-native-build").click();
  await expect(page.getByTestId("native-build-download")).toBeVisible({timeout:180000});await mkdir("evidence/native-editor",{recursive:true});await page.screenshot({path:"evidence/native-editor/complete-1280.png"});
  const downloadPromise=page.waitForEvent("download");await page.getByTestId("native-build-download").click();const download=await downloadPromise;await download.saveAs("evidence/native-editor/game-pc.zip");
  const bytes=await readFile("evidence/native-editor/game-pc.zip"),files=unzipSync(new Uint8Array(bytes)) as Record<string,Uint8Array>;
  const manuscript=Object.entries(files).find(([name])=>name.endsWith("/game/project.json"));expect(manuscript).toBeTruthy();expect(JSON.parse(new TextDecoder().decode(manuscript![1])).title).toBe(story.title);
  const released=JSON.parse(new TextDecoder().decode(manuscript![1]));expect(released.nativeSaveId).toMatch(/^[a-f0-9]{32}$/);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!));expect(saved.nativeSaveId).toBe(released.nativeSaveId);
  const options=Object.entries(files).find(([name])=>name.endsWith("/game/options.rpy"));expect(new TextDecoder().decode(options![1])).toContain(`define config.save_directory = "vnmaker-${released.nativeSaveId}"`);
  const native=Object.entries(files).find(([name])=>name.endsWith("/game/script.rpy"));expect(new TextDecoder().decode(native![1])).toContain(story.scenes[0]!.lines[0]!.text);expect(Object.keys(files).some(name=>name.endsWith(".exe"))).toBe(true);expect(Object.keys(files).some(name=>name.includes("/game/vn_qa."))).toBe(false);
  const id=await page.evaluate(()=>localStorage.getItem("vnmaker.native-build.last-job"));await writeFile("evidence/native-editor/result.json",JSON.stringify({id,filename:download.suggestedFilename(),size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")},null,2));
  const status=await(await page.request.get(`/api/native-build/jobs/${id}`,{headers})).json();expect(status.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));expect(status.project).toEqual({title:story.title,scenes:1,lines:2});
  await page.getByLabel("네이티브 빌드 창 닫기").click();await page.evaluate(()=>localStorage.removeItem("vnmaker.native-build.last-job"));await page.reload();await page.getByTestId("studio-native-build").click();await page.locator(".native-build-history summary").click();await page.getByTestId(`native-history-${id}`).click();await expect(page.getByTestId("native-build-download")).toBeVisible();await expect(page.getByLabel("빌드 결과")).toContainText(status.sha256);await page.screenshot({path:"evidence/native-editor/history-1280.png"});
  await page.getByLabel("네이티브 빌드 창 닫기").click();await page.getByLabel("작품 제목",{exact:true}).fill(story.title+" 업데이트");await page.getByTestId("studio-native-build").click();await page.getByTestId("native-build-start").click();await expect(page.getByTestId("native-build-download")).toBeVisible({timeout:180000});
  const updateId=await page.evaluate(()=>localStorage.getItem("vnmaker.native-build.last-job"));expect(updateId).not.toBe(id);
  const updated=await(await page.request.get(`/api/native-build/jobs/${updateId}`,{headers})).json();expect(updated.phase).toBe("complete");expect(updated.baselineJobId).toBe(id);expect(updated.artifact).toBe(status.artifact);await expect(page.getByLabel("빌드 결과")).toContainText(`이전 빌드 기준 · ${id}`);await page.screenshot({path:"evidence/native-editor/update-baseline.png"});await writeFile("evidence/native-editor/update-result.json",JSON.stringify({previous:id,current:updateId,artifact:updated.artifact,sha256:updated.sha256},null,2));
});
