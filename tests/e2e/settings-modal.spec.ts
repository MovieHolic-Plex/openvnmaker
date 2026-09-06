import {test,expect} from "@playwright/test";

test("settings owns keyboard focus, retains changes, and returns focus on close",async({page},info)=>{
  test.setTimeout(30000);
  await page.addInitScript(()=>sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"설정 조작",subtitle:"",start:"s",characters:[],scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"설정을 닫아도 이 줄에 머문다."}],ending:"끝"}]})));
  await page.goto("/?preview=1");const opener=page.getByTestId("settings-button");await opener.focus();await page.keyboard.press("Enter");
  const panel=page.getByTestId("settings-panel");await expect(panel).toBeVisible();
  await expect(panel.getByRole("button",{name:"닫기",exact:true})).toBeFocused();
  await expect(page.getByRole("dialog",{name:"플레이 설정",exact:true})).toBeVisible();
  for(let i=0;i<9;i++){await page.keyboard.press("Tab");expect(await panel.evaluate(node=>node.contains(document.activeElement))).toBe(true);}
  for(let i=0;i<9;i++){await page.keyboard.press("Shift+Tab");expect(await panel.evaluate(node=>node.contains(document.activeElement))).toBe(true);}
  await page.getByTestId("bgm-volume").fill("0.35");await page.getByTestId("bgm-volume").focus();await page.keyboard.press("ArrowRight");await expect(page.getByTestId("bgm-volume")).toHaveValue("0.4");
  await page.keyboard.press("Escape");await expect(panel).not.toBeVisible();await expect(opener).toBeFocused();expect(await page.evaluate(()=>window.__vn?.lineIndex)).toBe(0);
  await page.reload();await opener.click();await expect(page.getByTestId("bgm-volume")).toHaveValue("0.4");
  await page.setViewportSize({width:390,height:400});await page.screenshot({path:info.outputPath("settings-short-viewport.png")});
  await panel.getByRole("button",{name:"닫기",exact:true}).scrollIntoViewIfNeeded();await expect(panel.getByRole("button",{name:"닫기",exact:true})).toBeInViewport();
  await page.getByTestId("text-speed").scrollIntoViewIfNeeded();await expect(page.getByTestId("text-speed")).toBeInViewport();
  expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.getByTestId("credits-button").click();await expect(page.getByTestId("credits-panel")).toBeVisible();await page.keyboard.press("Escape");await expect(opener).toBeFocused();
});
