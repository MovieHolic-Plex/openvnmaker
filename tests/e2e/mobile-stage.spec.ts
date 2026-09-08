import {test,expect,type Page} from "@playwright/test";
import {script} from "../../packages/content/src/index.js";

function previewStorageReads(page:Page){
  return page.evaluate(()=>{
    const bag=Reflect.get(globalThis,"__previewReads");
    return Array.isArray(bag)?bag.filter((key):key is string=>typeof key==="string"&&key.startsWith("vnmaker.preview")):[];
  });
}

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
  for(const [index,scene] of source.scenes.entries()){
    await expect(page.getByTestId("stage")).toHaveAttribute("data-scene",scene.id);
    if(index===0){expect(nocturneRequests).toEqual([]);await expect(page.getByTestId("title-screen")).toHaveCount(0);}
    await expect(page.locator(".sprite canvas[data-loaded=true]")).toHaveCount(index+1);
    await expect(page.getByTestId("dialogue-text")).toHaveText(scene.lines[0]!.text);
    await expect(page.locator(".next-mark")).toBeVisible();
    await expect(page.getByTestId("dialogue-text")).toBeInViewport();await expect(page.getByTestId("settings-button")).toBeInViewport();
    expect((await page.locator(".sprite").first().boundingBox())!.width).toBeGreaterThan(390);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`portrait-${scene.id}.png`),animations:"disabled"});
    if(index===1)await expect(page.locator(".sprite.is-dim")).toHaveCSS("opacity","1");
    if(index<source.scenes.length-1)await page.getByTestId("skip-button").click();
  }
  await page.setViewportSize({width:1440,height:900});await page.screenshot({path:info.outputPath("desktop-three.png")});
});

test("valid preview reads sessionStorage only while mounting App",async({page})=>{
  const source={title:"부트 회귀",subtitle:"",start:"one",characters:[],scenes:[{id:"one",background:"title",lines:[{speaker:null,text:"미리보기 부트는 마운트에서만 읽어야 한다."}],ending:"끝"}]};
  await page.addInitScript(source=>{
    const original=Storage.prototype.getItem;
    const reads:string[]=[];
    Storage.prototype.getItem=function(key){
      if(this===sessionStorage)reads.push(String(key));
      return original.call(this,key);
    };
    Object.defineProperty(globalThis,"__previewReads",{configurable:true,get(){return reads.slice();}});
    sessionStorage.setItem("vnmaker.previewScript",JSON.stringify(source));
    localStorage.setItem("vnmaker:settings",JSON.stringify({textSpeed:5}));
  },source);
  await page.goto("/?preview=1");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene","one");
  await expect(page.getByTestId("dialogue-text")).toHaveText(source.scenes[0]!.lines[0]!.text);
  await expect(page.locator(".next-mark")).toBeVisible();
  const afterTyping=await previewStorageReads(page);
  expect(afterTyping.filter(key=>key==="vnmaker.previewScript")).toEqual(["vnmaker.previewScript"]);
  expect(afterTyping.filter(key=>key==="vnmaker.previewPosition")).toEqual(["vnmaker.previewPosition"]);
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-panel").getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  await expect(page.getByTestId("dialogue-text")).toHaveText(source.scenes[0]!.lines[0]!.text);
  const afterSettings=await previewStorageReads(page);
  expect(afterSettings).toEqual(afterTyping);
});
