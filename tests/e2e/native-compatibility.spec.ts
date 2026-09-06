import {withNarrativeIds} from "../../packages/app/src/studio/narrativeIds.js";
import {test,expect} from "@playwright/test";
import {readFile,writeFile} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import {createZip} from "../../packages/app/src/studio/zip.js";
import {arithmeticStory} from "../../packages/app/test/fixtures/arithmetic-story.js";
import {EDITION} from "../../packages/app/src/storage/edition.js";
import {unzipSync} from "../../packages/app/node_modules/fflate/esm/index.mjs";

test("compares a verified release before building and retains the exported manuscript report",async({page,browser},info)=>{
  test.setTimeout(240000);page.setDefaultTimeout(15000);const headers={"X-VNMaker-Studio":"1"};
  const original=withNarrativeIds({...arithmeticStory,nativeSaveId:randomUUID().replaceAll("-",""),scenes:arithmeticStory.scenes.map(scene=>scene.id==="start"?{...scene,lines:[{speaker:null,text:"동일한 대사"},{speaker:null,text:"동일한 대사"}],choices:scene.choices!.map(choice=>({...choice,text:"동일한 선택"}))}:scene)});
  const assets=await Promise.all(["bg/title.png","audio/bgm/main-theme.mp3","audio/sfx/ui-click.mp3","audio/sfx/ui-hover.mp3"].map(async path=>({path:`assets/${path}`,bytes:await readFile(`packages/app/public/assets/${path}`)})));
  const bundle=createZip([{path:"project.json",bytes:new TextEncoder().encode(JSON.stringify(original))},...assets]);const posted=await page.request.post("/api/native-build/jobs",{headers:{...headers,"Content-Type":"application/zip"},data:Buffer.from(await bundle.arrayBuffer())});expect(posted.status()).toBe(202);const {id:baselineId}=await posted.json();
  const baselineContext=await browser.newContext({baseURL:info.project.use.baseURL});
  try {
    const baselinePage=await baselineContext.newPage();
    await baselinePage.addInitScript(({original,edition,baselineId})=>{
      localStorage.setItem("vnmaker.edition",edition);
      localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(original));
      localStorage.setItem("vnmaker.native-build.last-job",baselineId);
    },{original,edition:EDITION,baselineId});
    await baselinePage.goto("/studio.html");
    const completed=baselinePage.waitForResponse(async response=>{
      if(!response.url().endsWith(`/api/native-build/jobs/${baselineId}`))return false;
      const result=await response.json();
      return result.phase==="complete"||result.phase==="failed";
    },{timeout:120000});
    await baselinePage.getByTestId("studio-native-build").click();
    expect((await(await completed).json()).phase).toBe("complete");
    await expect(baselinePage.getByTestId("native-build-download")).toBeVisible();
  } finally {
    await baselineContext.close();
  }
  const baseline=await(await page.request.get(`/api/native-build/jobs/${baselineId}`,{headers})).json();expect(baseline.phase).toBe("complete");
  const unchanged=await page.request.post("/api/native-build/compatibility",{headers:{...headers,"X-VNMaker-Baseline":baselineId},data:original});expect(unchanged.ok()).toBe(true);expect((await unchanged.json()).analysis.status).toBe("no-detected-changes");
  const story={...original,musicFadeSeconds:2.4,title:"출시 후 구조 변경 검증",flags:{trust:10,bonus:7},scenes:original.scenes.filter(scene=>scene.id!=="ordinary").map(scene=>scene.id==="start"?{...scene,choices:[...scene.choices!].reverse().map((choice,index)=>index===0?{...choice,add:{trust:5}}:choice),lines:[{id:"inserted-line",speaker:null,text:"새로 삽입한 대사입니다."},...scene.lines.slice().reverse().map((line,index)=>index===0?{...line,text:"수정한 기존 대사"}:line)]}:scene.id==="gate"?{...scene,choices:[scene.choices![0]!]}:scene)};
  await page.addInitScript(({story,edition,baselineId})=>{if(localStorage.getItem("comparison-seed"))return;localStorage.setItem("comparison-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));localStorage.setItem(`vnmaker.native-baseline.${story.nativeSaveId}`,baselineId);},{story,edition:EDITION,baselineId});
  await page.setViewportSize({width:1440,height:1000});await page.goto("/studio.html");await page.getByTestId("studio-native-build").click();const response=page.waitForResponse(response=>response.url().endsWith("/api/native-build/compatibility")&&response.request().method()==="POST");await page.getByRole("button",{name:"기준 출시본과 변경 비교",exact:true}).click();const comparisonResponse=await response,comparison=await comparisonResponse.json();expect(comparison.baseline.jobId).toBe(baselineId);expect(comparison.baseline.artifactSha256).toBe(baseline.sha256);expect(comparison.currentManuscriptHash).toBe(createHash("sha256").update(JSON.stringify(comparisonResponse.request().postDataJSON())).digest("hex"));
  for(const code of ["scene-removed","line-count","choice-count","flag-default","flag-added","music-fade","choice-order","choice-logic","line-order","dialogue-changed","line-added"])expect(comparison.analysis.issues.some((issue:{code:string})=>issue.code===code)).toBe(true);
  const view=page.getByLabel("출시본 변경 검사 결과",{exact:true});await expect(view).toContainText("호환성을 보장하지 않습니다");await expect(view).toContainText("장면 ordinary");await view.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("preflight.png")});await writeFile(info.outputPath("preflight.json"),JSON.stringify(comparison,null,2));
  await writeFile(info.outputPath("preflight-http.json"),JSON.stringify({status:comparisonResponse.status(),headers:comparisonResponse.headers(),body:comparison},null,2));
  await page.getByLabel("네이티브 빌드 창 닫기").click();await page.getByLabel("작품 제목",{exact:true}).fill("수정된 편집본의 변경 검사");await page.getByTestId("studio-native-build").click();await expect(view).toHaveCount(0);
  await page.getByTestId("native-build-start").click();await expect(page.getByTestId("native-build-download")).toBeVisible({timeout:120000});const jobId=await page.evaluate(()=>localStorage.getItem("vnmaker.native-build.last-job"));const job=await(await page.request.get(`/api/native-build/jobs/${jobId}`,{headers})).json();expect(job.compatibilitySha256).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole("button",{name:"이 빌드의 변경 검사 보기",exact:true}).click();const builtView=page.getByLabel("빌드 당시 변경 검사 결과",{exact:true});await expect(builtView).toContainText("장면 ordinary");const download=page.waitForEvent("download");await builtView.getByRole("link",{name:"빌드 당시 검사 JSON",exact:true}).click();await(await download).saveAs(info.outputPath("build-report.json"));const bytes=await readFile(info.outputPath("build-report.json")),report=JSON.parse(bytes.toString());expect(createHash("sha256").update(bytes).digest("hex")).toBe(job.compatibilitySha256);expect(report.baseline.jobId).toBe(baselineId);
  const exported=JSON.parse(await readFile(`output/editor-native-builds/${jobId}/project/game/project.json`,"utf8"));expect(report.currentManuscriptHash).toBe(createHash("sha256").update(JSON.stringify(exported)).digest("hex"));expect(report.analysis.counts.high).toBeGreaterThan(0);for(const code of ["music-fade","choice-order","choice-logic","line-order","dialogue-changed","line-added"])expect(report.analysis.issues.some((issue:{code:string})=>issue.code===code)).toBe(true);
  expect(job.compatibilityCounts).toEqual(report.analysis.counts);const archive=await readFile(`output/editor-native-builds/${jobId}/distribution/${job.artifact}`);const archived=unzipSync(archive,{filter:entry=>entry.name.endsWith("/release-compatibility.json")});expect(Object.keys(archived)).toHaveLength(1);expect(createHash("sha256").update(Object.values(archived)[0]!).digest("hex")).toBe(job.compatibilitySha256);
  await page.setViewportSize({width:390,height:820});await builtView.scrollIntoViewIfNeeded();const box=await builtView.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);await page.screenshot({path:info.outputPath("build-report-390.png")});await writeFile(info.outputPath("jobs.json"),JSON.stringify({baseline:baselineId,current:jobId,reportSha256:job.compatibilitySha256},null,2));
});
