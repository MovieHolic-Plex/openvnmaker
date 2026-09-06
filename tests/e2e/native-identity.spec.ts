import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {arithmeticStory as story} from "../../packages/app/test/fixtures/arithmetic-story.js";
import {EDITION} from "../../packages/app/src/storage/edition.js";

test("native release ID is retained through editing, reload and manuscript export",async({page})=>{
  await page.addInitScript(({story,edition})=>{if(localStorage.getItem("release-seed"))return;localStorage.setItem("release-seed","1");localStorage.setItem("vnmaker.edition",edition);localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(story));},{story,edition:EDITION});
  await page.setViewportSize({width:1440,height:1000});await page.goto("/studio.html");await page.getByTestId("studio-native-build").click();await page.getByText("배포 ID와 업데이트",{exact:true}).click();
  const input=page.getByLabel("네이티브 배포 ID",{exact:true});await input.fill("../bad");await input.press("Tab");await expect(input).toHaveValue("");await expect(page.getByRole("alert")).toContainText("16자리");
  await input.fill("0123456789abcdef");await input.press("Tab");await expect(input).toHaveValue("0123456789abcdef");await page.getByLabel("네이티브 빌드 창 닫기").click();
  await page.getByLabel("작품 제목",{exact:true}).fill("출시 후 제목 수정");await page.reload();await page.getByTestId("studio-native-build").click();await page.getByText("배포 ID와 업데이트",{exact:true}).click();await expect(input).toHaveValue("0123456789abcdef");await mkdir("evidence/native-identity",{recursive:true});await page.screenshot({path:"evidence/native-identity/settings.png"});await page.getByLabel("네이티브 빌드 창 닫기").click();
  const download=page.waitForEvent("download");await page.getByTestId("studio-export").click();const file=await download;await file.saveAs("evidence/native-identity/project.json");
  const stream=await file.createReadStream();let data="";for await(const chunk of stream!)data+=chunk.toString();expect(JSON.parse(data).nativeSaveId).toBe("0123456789abcdef");expect(JSON.parse(data).title).toBe("출시 후 제목 수정");
  await page.getByTestId("project-library").click();await page.getByLabel("내 작품 보관함",{exact:true}).locator("article").filter({hasText:"출시 후 제목 수정"}).getByRole("button",{name:"복제",exact:true}).click();
  await expect(page.getByLabel("작품 제목",{exact:true})).toHaveValue("출시 후 제목 수정 · 복사");await page.getByTestId("studio-native-build").click();await page.getByText("배포 ID와 업데이트",{exact:true}).click();await expect(input).toHaveValue("");
});
