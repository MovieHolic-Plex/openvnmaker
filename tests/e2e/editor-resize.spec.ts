import {test,expect} from "@playwright/test";

test("editor resize does not feed layout writes back into ResizeObserver delivery",async({page},info)=>{
  test.setTimeout(45000);
  await page.addInitScript(()=>{
    (window as unknown as {resizeErrors:string[]}).resizeErrors=[];
    window.addEventListener("error",event=>{if(event.message.includes("ResizeObserver"))(window as unknown as {resizeErrors:string[]}).resizeErrors.push(event.message);});
  });
  await page.goto("/studio.html");await page.getByTestId("workspace-characters").click();
  await expect.poll(()=>page.locator("canvas[data-src][data-loaded=true]").count()).toBeGreaterThan(0);
  for(const width of [390,1280,600,1440,420,1024,390,1440]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  }
  await page.getByTestId("workspace-stage").click();
  for(const width of [600,1440,390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
  await expect(page.getByTestId("studio-stage")).toBeVisible();
  await page.getByTestId("workspace-characters").click();
  await expect.poll(()=>page.locator("canvas[data-src][data-loaded=true]").count()).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as unknown as {resizeErrors:string[]}).resizeErrors)).toEqual([]);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath("resized-characters.png")});
});
