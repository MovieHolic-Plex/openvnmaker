import {test,expect} from "@playwright/test";

test("long public credit text stays readable and scrollable in a short mobile viewport",async({page},info)=>{
  test.setTimeout(30000);
  await page.setViewportSize({width:390,height:600});
  await page.addInitScript(()=>{
    sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"긴 크레딧 검증",subtitle:"",start:"s",characters:[],assets:Array.from({length:30},(_,i)=>({id:`art-${i}`,kind:"background",name:`소재 ${i}`,url:"/assets/bg/title.png",provenance:{creator:"제작자",license:"허용 조건",source:"비공개 구매 기록",credit:i===0?"<script>alert(1)</script>"+"긴표기문".repeat(700):`표기문 ${i}`}})),scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"현재 대사"}],ending:"끝"}]}));
  });
  await page.goto("/?preview=1");await page.getByTestId("settings-button").click();await page.getByTestId("credits-button").click();
  const panel=page.getByTestId("credits-panel");await expect(panel).toContainText("<script>alert(1)</script>");await expect(panel.locator("script")).toHaveCount(0);await expect(panel).not.toContainText("비공개 구매 기록");
  expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await panel.getByText("표기문 29",{exact:true}).scrollIntoViewIfNeeded();await expect(panel.getByText("표기문 29",{exact:true})).toBeInViewport();await expect(panel.getByRole("button",{name:"닫기"})).toBeInViewport();
  await page.screenshot({path:info.outputPath("credits-long-mobile.png")});
  await page.keyboard.press("Escape");expect(await page.evaluate(()=>window.__vn?.lineIndex)).toBe(0);
});
