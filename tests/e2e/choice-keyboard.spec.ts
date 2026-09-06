import {test,expect} from "@playwright/test";

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"선택지 조작",subtitle:"",start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"선택을 기다립니다."}],choices:Array.from({length:8},(_,i)=>({text:`선택 ${i+1}: 충분히 긴 설명을 읽고 원하는 결정을 내릴 수 있어야 합니다. 반복되는 갈림길에서도 마지막 항목을 확인합니다.`,next:"end",set:{picked:i},...(i===0?{when:{all:["secret"]}}:{}),...(i===1?{disable:true}:{})}))},{id:"end",background:"title",lines:[{speaker:null,text:"선택 완료"}],ending:"끝"}]})));
  await page.goto("/?preview=1");await page.getByTestId("skip-button").click();
});

test("choice arrows skip unavailable entries and reach the last long option",async({page},info)=>{
  test.setTimeout(30000);
  await page.setViewportSize({width:390,height:844});await expect(page.getByTestId("choice-2")).toBeFocused();
  await expect(page.getByTestId("choice-2")).toHaveCSS("opacity","1");
  await expect(page.getByTestId("choice-1")).toHaveCSS("opacity","0.45");
  await page.screenshot({path:info.outputPath("choices-before-navigation.png")});
  await page.keyboard.press("ArrowDown");await expect(page.getByTestId("choice-3")).toBeFocused();
  await page.keyboard.press("Home");await expect(page.getByTestId("choice-2")).toBeFocused();
  await page.keyboard.press("ArrowUp");await expect(page.getByTestId("choice-7")).toBeFocused();
  await expect(page.getByTestId("choice-7")).toBeInViewport();
  await expect(page.getByTestId("choice-7")).toHaveCSS("opacity","1");
  await page.keyboard.press("Home");await page.keyboard.press("End");await expect(page.getByTestId("choice-7")).toBeFocused();
  await page.screenshot({path:info.outputPath("choices-last-mobile.png")});
  expect(await page.getByTestId("choice-menu").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.keyboard.press("Enter");await expect(page.getByTestId("dialogue-text")).toHaveText("선택 완료");expect(await page.evaluate(()=>window.__vn?.flags.picked)).toBe(7);
});

test("displayed choice number activates only an available matching option",async({page})=>{
  test.setTimeout(30000);
  await expect(page.getByTestId("choice-2")).toBeFocused();await page.keyboard.press("1");await page.keyboard.press("2");await expect(page.getByTestId("choice-menu")).toBeVisible();
  await page.keyboard.press("Control+3");await expect(page.getByTestId("choice-menu")).toBeVisible();
  await page.keyboard.press("3");await expect(page.getByTestId("dialogue-text")).toHaveText("선택 완료");expect(await page.evaluate(()=>window.__vn?.flags.picked)).toBe(2);
});
