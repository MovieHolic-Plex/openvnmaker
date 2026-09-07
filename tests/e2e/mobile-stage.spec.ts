import {test,expect} from "@playwright/test";
import {script} from "../../packages/content/src/index.js";

test("portrait player keeps one and multiple actors large without hiding dialogue or controls",async({page},info)=>{
  const source={...script,start:"one",scenes:[
    {id:"one",chapter:"한 명",background:"title",backgroundUrl:"/assets/art/atelier-golden-hour.png",sprites:[{slot:"center",character:script.characters[0]!.id}],lines:[{speaker:script.characters[0]!.id,text:"화면이 좁아져도 표정과 이야기를 함께 볼 수 있어야 한다."}],next:"two"},
    {id:"two",chapter:"두 명",background:"title",sprites:[{slot:"left",character:script.characters[0]!.id},{slot:"right",character:script.characters[1]!.id}],lines:[{speaker:script.characters[1]!.id,text:"두 사람이 마주 선 순간에도 대사는 읽기 편해야 한다."}],next:"three"},
    {id:"three",chapter:"세 명",background:"title",sprites:[{slot:"left",character:script.characters[0]!.id},{slot:"center",character:script.characters[2]!.id},{slot:"right",character:script.characters[1]!.id}],lines:[{speaker:null,text:"세 사람이 함께 남긴 장면이다."}],ending:"끝"}
  ]};
  await page.addInitScript(source=>{sessionStorage.setItem("vnmaker.previewScript",JSON.stringify(source));localStorage.setItem("vnmaker:settings",JSON.stringify({textSpeed:5}));},source);
  const nocturneRequests:string[]=[];
  page.on("request",request=>{if(new URL(request.url()).pathname.includes("nocturne-atrium"))nocturneRequests.push(request.url());});
  await page.setViewportSize({width:390,height:844});await page.goto("/?preview=1");
  for(const [index,id] of ["one","two","three"].entries()){
    await expect.poll(()=>page.evaluate(()=>window.__vn?.sceneId)).toBe(id);
    if(index===0){expect(nocturneRequests).toEqual([]);await expect(page.getByTestId("title-screen")).toHaveCount(0);}
    await expect(page.locator(".sprite canvas[data-loaded=true]")).toHaveCount(index+1);
    await expect.poll(()=>page.evaluate(()=>window.__vn?.typing)).toBe(false);
    await expect(page.getByTestId("dialogue-text")).toBeInViewport();await expect(page.getByTestId("settings-button")).toBeInViewport();
    expect((await page.locator(".sprite").first().boundingBox())!.width).toBeGreaterThan(390);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`portrait-${id}.png`),animations:"disabled"});
    if(index===1)await expect(page.locator(".sprite.is-dim")).toHaveCSS("opacity","1");
    if(index<2)await page.getByTestId("skip-button").click();
  }
  await page.setViewportSize({width:1440,height:900});await page.screenshot({path:info.outputPath("desktop-three.png")});
});
