import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {EDITION} from "../../packages/app/src/storage/edition.js";
import {framingStory as story} from "../../packages/app/test/fixtures/framing-story.js";
test("web framing shows cinematic bars, contains portrait CG and restores actors after CG",async({page})=>{
  await page.addInitScript(({story,edition})=>{localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await mkdir("evidence/framing",{recursive:true});await page.setViewportSize({width:1280,height:720});await page.goto("/studio.html");await page.getByTestId("studio-scene-s").click();await page.getByTestId("studio-play").click();
  for(let index=0;index<7;index++){
    await expect(page.getByTestId("dialogue-text")).toHaveText(story.scenes[0].lines[index].text);
    await expect(page.locator(".cinematic-bars")).toHaveCount([1,3,4].includes(index)?1:0);
    await expect(page.getByTestId("sprite-left")).toHaveCount([3,4].includes(index)?0:1);await expect(page.getByTestId("sprite-right")).toHaveCount([3,4].includes(index)?0:1);
    if([3,4].includes(index))await expect(page.getByTestId("bg-image")).toHaveCSS("object-fit","contain");
    if([0,1,6].includes(index))await expect(page.getByTestId("bg-image")).toHaveCSS("transform","none");
    if([2,5].includes(index))await expect(page.getByTestId("bg-image")).toHaveCSS("transform","matrix(1.13, 0, 0, 1.13, 0, 0)");
    await page.screenshot({path:`evidence/framing/web-${index}.png`});if(index<6)await page.getByTestId("advance-button").click();
  }
});
