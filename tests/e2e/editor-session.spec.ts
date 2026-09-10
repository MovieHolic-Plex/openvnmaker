import {test,expect} from "@playwright/test";

const key="vnmaker.studio.project.v1";
test("a waiting tab never autosaves and opens the latest manuscript after the writer closes",async({page,context},info)=>{
  await page.goto("/studio.html");
  await page.getByLabel("작품 제목").fill("동시 편집 · 첫 저장");
  const waiting=await context.newPage();await waiting.goto("/studio.html");
  await expect(waiting.getByRole("heading",{name:"다른 탭에서 편집 중입니다"})).toBeVisible();
  await expect(waiting.getByLabel("작품 제목")).toHaveCount(0);
  await page.getByLabel("작품 제목").fill("동시 편집 · 최신 저장");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  expect(await waiting.evaluate(k=>JSON.parse(localStorage.getItem(k)!).title,key)).toBe("동시 편집 · 최신 저장");
  await waiting.keyboard.press("Control+s");
  await waiting.screenshot({path:info.outputPath("waiting-desktop.png")});
  await waiting.setViewportSize({width:390,height:844});
  await waiting.screenshot({path:info.outputPath("waiting-mobile.png")});
  await waiting.setViewportSize({width:1280,height:720});
  await waiting.reload();
  await expect(waiting.getByRole("heading",{name:"다른 탭에서 편집 중입니다"})).toBeVisible();
  expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!).title,key)).toBe("동시 편집 · 최신 저장");
  await page.close();
  await expect(waiting.getByLabel("작품 제목")).toHaveValue("동시 편집 · 최신 저장");
  await waiting.getByLabel("작품 제목").fill("권한을 받은 탭의 편집");
  await expect(waiting.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  expect(await waiting.evaluate(k=>JSON.parse(localStorage.getItem(k)!).title,key)).toBe("권한을 받은 탭의 편집");
  await waiting.reload();await expect(waiting.getByLabel("작품 제목")).toHaveValue("권한을 받은 탭의 편집");
});

test("simultaneous opens yield exactly one editor and one waiting document",async({context})=>{
  const first=await context.newPage(),second=await context.newPage();
  await Promise.all([first.goto("/studio.html"),second.goto("/studio.html")]);
  await Promise.race([first.getByLabel("작품 제목").waitFor({state:"visible"}),second.getByLabel("작품 제목").waitFor({state:"visible"})]);
  expect(await first.getByLabel("작품 제목").count()+await second.getByLabel("작품 제목").count()).toBe(1);
  const owner=await first.getByLabel("작품 제목").count()?first:second,waiting=owner===first?second:first;
  await expect(waiting.getByRole("heading",{name:"다른 탭에서 편집 중입니다"})).toBeVisible();
  await owner.close();await expect(waiting.getByLabel("작품 제목")).toBeVisible();
});

test("unsupported lock environments leave project storage untouched",async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,"locks",{value:undefined});localStorage.setItem("vnmaker.studio.project.v1",'{"sentinel":"preserve"}');});
  await page.goto("/studio.html");
  await expect(page.getByRole("heading",{name:"편집기를 안전하게 열 수 없습니다"})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe('{"sentinel":"preserve"}');
});
