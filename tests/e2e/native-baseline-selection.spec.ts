import {test,expect} from "@playwright/test";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {createZip} from "../../packages/app/src/studio/zip.js";
import {EDITION} from "../../packages/app/src/storage/edition.js";

test("a pinned older release survives reload and is used instead of the latest build",async({page})=>{
  test.setTimeout(300000);page.setDefaultTimeout(15000);
  const story={title:"출시 기준 선택 검증",subtitle:"",nativeSaveId:randomUUID().replaceAll("-",""),start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"출시 기준을 유지하는 작품입니다."}],ending:"끝"}]};
  const headers={"X-VNMaker-Studio":"1"},assets=await Promise.all(["bg/title.png","audio/bgm/main-theme.mp3","audio/sfx/ui-click.mp3","audio/sfx/ui-hover.mp3"].map(async path=>({path:`assets/${path}`,bytes:await readFile(`packages/app/public/assets/${path}`)})));
  async function submit(source:typeof story,baseline?:string){
    const zip=createZip([{path:"project.json",bytes:new TextEncoder().encode(JSON.stringify(source))},...assets]);
    const response=await page.request.post("/api/native-build/jobs",{headers:{...headers,"Content-Type":"application/zip",...(baseline?{"X-VNMaker-Baseline":baseline}:{})},data:Buffer.from(await zip.arrayBuffer())});expect(response.status()).toBe(202);const {id}=await response.json();
    await expect.poll(async()=>(await(await page.request.get(`/api/native-build/jobs/${id}`,{headers})).json()).phase,{timeout:120000}).toMatch(/^(complete|failed)$/);
    return await(await page.request.get(`/api/native-build/jobs/${id}`,{headers})).json();
  }
  const first=await submit({...story,title:"출시본 A"});expect(first.phase).toBe("complete");const previous=first.id;
  const later=await submit({...story,title:"중간 테스트 B"});expect(later.phase).toBe("complete");const newer=later.id;
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("baseline-seed"))return;localStorage.setItem("baseline-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await page.setViewportSize({width:1440,height:1000});await page.goto("/studio.html");await page.getByTestId("studio-native-build").click();
  const select=page.getByLabel("업데이트 기준 빌드",{exact:true});await expect(select.locator(`option[value="${previous}"]`)).toHaveCount(1);await expect(select.locator(`option[value="${newer}"]`)).toHaveCount(1);await select.selectOption(previous);
  await page.getByLabel("네이티브 빌드 창 닫기").click();await page.reload();await page.getByTestId("studio-native-build").click();await expect(select).toHaveValue(previous);await mkdir("evidence/native-baseline-selection",{recursive:true});await page.screenshot({path:"evidence/native-baseline-selection/pinned.png"});
  const upload=page.waitForRequest(request=>request.method()==="POST"&&request.url().endsWith("/api/native-build/jobs"));await page.getByTestId("native-build-start").click();expect((await upload).headers()["x-vnmaker-baseline"]).toBe(previous);
  await expect(page.getByTestId("native-build-download")).toBeVisible({timeout:120000});
  const id=await page.evaluate(()=>localStorage.getItem("vnmaker.native-build.last-job"));const result=await(await page.request.get(`/api/native-build/jobs/${id}`,{headers})).json();expect(result.phase).toBe("complete");expect(result.requestedBaselineJobId).toBe(previous);expect(result.baselineJobId).toBe(previous);await expect(page.getByLabel("빌드 결과")).toContainText(`이전 빌드 기준 · ${previous}`);await writeFile("evidence/native-baseline-selection/result.json",JSON.stringify(result,null,2));
  for(const width of [390,1280]){await page.setViewportSize({width,height:820});await select.scrollIntoViewIfNeeded();const box=await select.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);await page.screenshot({path:`evidence/native-baseline-selection/pinned-${width}.png`});}
  await select.selectOption("");expect(await page.evaluate(identity=>localStorage.getItem(`vnmaker.native-baseline.${identity}`),story.nativeSaveId)).toBeNull();
  const rejected=await submit({...story,nativeSaveId:randomUUID().replaceAll("-","")},previous);expect(rejected.phase).toBe("failed");expect(rejected.log).toContain("같은 작품");expect(rejected.baselineJobId).toBeUndefined();
});

test("a missing pinned baseline is not silently replaced by automatic selection",async({page})=>{
  const missing="11111111-2222-4333-8444-555555555555",identity="fa00112233445566778899aabbccddee";
  const story={title:"없는 기준 검증",subtitle:"",nativeSaveId:identity,start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"기준 오류 확인"}],ending:"끝"}]};
  await page.addInitScript(({story,edition,missing,identity})=>{localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));localStorage.setItem(`vnmaker.native-baseline.${identity}`,missing);},{story,edition:EDITION,missing,identity});
  await page.goto("/studio.html");await page.getByTestId("studio-native-build").click();await expect(page.getByLabel("업데이트 기준 빌드",{exact:true})).toHaveValue(missing);await page.getByTestId("native-build-start").click();await expect(page.getByRole("alert")).toContainText("선택한 기준 빌드가 없거나 완료되지 않았습니다.");await expect(page.getByTestId("native-build-download")).toHaveCount(0);
});

test("a malformed local preference can be explicitly reset even with no available releases",async({page})=>{
  const identity="bad0112233445566778899aabbccddee",story={title:"기준 복구 검증",subtitle:"",nativeSaveId:identity,start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"기준 선택 복구"}],ending:"끝"}]};
  await page.addInitScript(({story,edition,identity})=>{localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));localStorage.setItem(`vnmaker.native-baseline.${identity}`,"../invalid");},{story,edition:EDITION,identity});
  await page.goto("/studio.html");await page.getByTestId("studio-native-build").click();const section=page.getByLabel("업데이트 기준",{exact:true});await expect(section.getByRole("alert")).toContainText("저장된 기준 빌드 ID");await section.getByRole("button",{name:"기준 선택 초기화",exact:true}).click();await expect(section.getByRole("alert")).toHaveCount(0);await expect(page.getByLabel("업데이트 기준 빌드",{exact:true})).toHaveValue("");expect(await page.evaluate(identity=>localStorage.getItem(`vnmaker.native-baseline.${identity}`),identity)).toBeNull();
});
