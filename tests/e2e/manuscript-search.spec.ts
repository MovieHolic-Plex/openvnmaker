import {test,expect} from "@playwright/test";

test("full manuscript search reaches repeated lines, actors, and results beyond the first page",async({page},info)=>{
  test.setTimeout(60000);
  await page.addInitScript(()=>localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify({title:"검색 검증",subtitle:"",start:"scene-a",characters:[{id:"witness",name:"이서하",bio:"목격자",color:"#abcdef"}],scenes:[{id:"scene-a",chapter:"도서관",background:"title",lines:Array.from({length:65},(_,index)=>({speaker:"witness",text:`반복 단서 ${index+1}`})),next:"scene-b"},{id:"scene-b",chapter:"새벽",background:"title",lines:[{speaker:null,text:"마지막 기록"}],ending:"진실"}]})));
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-line-text")).toHaveValue("반복 단서 1");
  await page.keyboard.press("Control+k");const dialog=page.getByRole("dialog");const search=page.getByLabel("장면 또는 대사 검색");
  await search.fill("반복 단서");await expect(dialog.getByRole("status")).toHaveText(/65개/);
  await dialog.getByRole("button",{name:/결과 더 보기/}).click();
  await dialog.getByRole("button",{name:/65줄 · 이서하/}).click();await expect(page.getByTestId("studio-line-text")).toHaveValue("반복 단서 65");
  await page.keyboard.press("Control+k");await search.fill("이서하");await expect(dialog.getByRole("status")).toHaveText(/65개/);
  for(let i=0;i<42;i++)await search.press("ArrowDown");
  await expect(dialog.locator(".is-selected")).toContainText("43줄");await expect(dialog.locator(".is-selected")).toBeInViewport();
  await page.screenshot({path:info.outputPath("search-desktop.png")});
  await search.press("Enter");await expect(page.getByTestId("studio-line-text")).toHaveValue("반복 단서 43");
  await page.keyboard.press("Control+k");await search.fill("없는문자");await search.press("ArrowDown");await search.press("Enter");await expect(dialog).toBeVisible();
  await search.fill("witness");await expect(dialog.getByRole("status")).toHaveText(/65개/);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath("search-mobile.png")});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await search.fill("scene-b");await search.press("Enter");await expect(page.getByTestId("studio-line-text")).toHaveValue("마지막 기록");
  await page.keyboard.press("Control+k");await search.fill("진실");await expect(dialog.getByRole("status")).toHaveText(/1개/);await search.press("Escape");await expect(dialog).not.toBeVisible();
});
