import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { script } from "../../packages/content/src/index.js";

test("old projects/checkpoints/saves are removed once; new edits survive reload; no internal AI requests", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url()); });
  await page.addInitScript(() => {
    if (localStorage.getItem("test-seeded")) return;
    localStorage.setItem("test-seeded", "1");
    localStorage.setItem("vnmaker.studio.project.v1", '{"title":"이전 작품"}');
    localStorage.setItem("vnmaker.studio.production.v1", '{"title":"이전 초안"}');
    localStorage.setItem("vnmaker.studio.production.previous.v1", '{}');
    localStorage.setItem("vnmaker:save", '{"sceneId":"old-scene"}');
    localStorage.setItem("vnmaker:settings", '{"bgmVolume":0.3}');
    sessionStorage.setItem("vnmaker.previewScript", "old");
  });
  await page.goto("/studio.html");
  await expect(page.getByLabel("작품 제목")).toHaveValue(script.title);
  expect(await page.evaluate(() => localStorage.getItem("vnmaker.studio.production.v1"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("vnmaker:save"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("vnmaker:settings"))).toContain("0.3");
  await page.getByTestId("workspace-stage").click();
  await page.getByTestId("studio-line-1").click();
  await page.getByTestId("studio-line-text").fill("새 작품의 저장을 검증하는 독립된 대사입니다.");
  await page.reload(); await page.getByTestId("workspace-stage").click(); await page.getByTestId("studio-line-1").click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue("새 작품의 저장을 검증하는 독립된 대사입니다.");
  await page.getByTestId("workspace-assets").click();
  await expect(page.getByTestId("art-library")).toBeVisible();
  await expect(page.getByTestId("art-generate")).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});

for (let route = 0; route < 8; route++) test(`complete published path ${route + 1} plays through three choices to correct ending`, async ({ page }) => {
  await mkdir("evidence/rain-novel", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: script.title, exact: true })).toBeVisible();
  if (route === 0) await page.screenshot({ path: "evidence/rain-novel/title.png" });
  await page.getByTestId("start-button").click();
  const visited = new Set<string>();
  for (let step = 0; step < 30; step++) {
    await expect.poll(async () => (await page.evaluate(() => window.__vn))?.phase).toMatch(/scene|choice|ending/);
    const state = await page.evaluate(() => window.__vn!);
    expect(state.error).toBeNull();
    if (state.phase === "ending") break;
    visited.add(state.sceneId);
    const scene = script.scenes.find(scene => scene.id === state.sceneId)!;
    const currentBackground = scene.lines.slice(0,state.lineIndex+1).reduce<string|undefined>((background,line)=>line.backgroundUrl ?? background,scene.backgroundUrl);
    await expect(page.getByTestId("bg-image")).toHaveAttribute("src", scene.lines.slice(0,state.lineIndex+1).reduce<string|null|undefined>((cg,line)=>line.cgUrl === undefined ? cg : line.cgUrl,scene.cgUrl) ?? currentBackground!);
    if (route === 0 && ["s03", "s10", "s17a"].includes(state.sceneId) || route === 7 && state.sceneId === "s12b") {
      await page.getByTestId("bg-image").evaluate(image => new Promise<void>(resolve => { if ((image as HTMLImageElement).complete) resolve(); else image.addEventListener("load", () => resolve(), { once: true }); }));
      await page.getByTestId("advance-button").click();
      await page.screenshot({ path: `evidence/rain-novel/scene-${state.sceneId}.png` });
    }
    if (state.phase === "choice") {
      const bit = state.sceneId === "s05" ? 0 : state.sceneId === "s11" ? 1 : 2;
      await page.getByTestId(`choice-${(route >> bit) & 1}`).click();
    } else await page.getByTestId("skip-button").click();
  }
  await expect(page.getByTestId("ending-screen")).toBeVisible();
  expect(visited.size).toBe(17);
  const ending = script.scenes.find(scene => scene.id === ((route & 4) ? "s17b" : "s17a"))!.ending!;
  await expect(page.getByTestId("ending-title")).toHaveText(ending);
  if (route === 0 || route === 7) await page.screenshot({ path: `evidence/rain-novel/ending-${route === 0 ? "a" : "b"}.png` });
});

test("project CG, camera, undo and preview consume the same artwork", async ({ page }) => {
  await page.goto("/studio.html");
  await page.getByTestId("workspace-assets").click();
  await page.getByTestId("art-card-rain-rain-umbrella-cg").click();
  await page.getByTestId("art-apply").click();
  await page.getByTestId("workspace-stage").click();
  await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/rain-umbrella-cg.png");
  await expect(page.locator(".preview-frame .sprite")).toHaveCount(0);
  await page.getByTestId("studio-undo").click();
  await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src", script.scenes[0]!.backgroundUrl!);
  await page.getByTestId("studio-line-2").click();
  await page.getByTestId("studio-play").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene", "s01");
  await expect(page.getByTestId("dialogue-text")).toHaveText(script.scenes[0]!.lines[2]!.text);
  await page.getByTestId("save-button").click();
  await page.reload();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene", "s01");
});

test("CG cues follow their dialogue lines and keyed character art has transparent surroundings", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/studio.html"); await page.getByTestId("workspace-stage").click();
  const actor = page.getByTestId("sprite-right");
  await expect(actor).toHaveAttribute("data-loaded", "true");
  const alpha = await actor.evaluate(canvas => {
    const node = canvas as HTMLCanvasElement;
    const ctx = node.getContext("2d")!;
    return { corner: ctx.getImageData(0,0,1,1).data[3], pixels: Array.from(ctx.getImageData(0,0,node.width,node.height).data).filter((_,index) => index % 4 === 3) };
  });
  expect(alpha.corner).toBe(0); expect(alpha.pixels.some(value => value > 240)).toBe(true);
  await page.getByTestId("studio-scene-s10").click();
  await page.getByTestId("studio-line-25").click();
  await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/rooftop-before-dawn.png");
  await page.getByRole("button", { name: "다음 대사", exact: true }).click();
  await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/blue-pigment-cg.png");
  await page.getByRole("button", { name: "집중 모드", exact: true }).click();
  await page.screenshot({ path: "evidence/rain-novel/editor-cg-cue.png" });
  await page.getByRole("button", { name: "다음 대사", exact: true }).click();
  await page.getByRole("button", { name: "다음 대사", exact: true }).click();
  await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/rooftop-before-dawn.png");
});

test("all character expressions render cleanly and art selection stays usable on mobile", async ({ page }) => {
  await mkdir("evidence/rain-novel", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio.html");
  await page.getByTestId("workspace-assets").click();
  await expect(page.locator(".art-count")).toContainText(String(script.assets!.length));
  await expect(page.locator(".art-grid .art-card")).toHaveCount(script.assets!.length);
  await page.screenshot({ path: "evidence/rain-novel/art-library.png" });
  await page.getByRole("group", { name:"이미지 종류" }).getByRole("button", { name: /캐릭터/ }).click();
  const portraits = page.locator(".art-grid canvas");
  await expect(portraits).toHaveCount(12);
  for (const portrait of await portraits.all()) {
    await expect(portrait).toHaveAttribute("data-loaded", "true");
    expect(await portrait.evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
      let visible = 0;
      for (let index=3;index<pixels.length;index+=4) if(pixels[index]!>240)visible++;
      return pixels[3] === 0 && visible > canvas.width * canvas.height * .1;
    })).toBe(true);
  }
  await page.screenshot({ path: "evidence/rain-novel/art-expressions.png" });
  await page.getByTestId("art-card-rain-seorin-smile").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("art-mobile-preview")).toHaveAttribute("data-loaded", "true");
  await expect(page.getByTestId("art-quick-apply")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "evidence/rain-novel/art-mobile.png" });
  await page.getByTestId("art-quick-apply").click();
  await expect(page.locator(".art-mobile-selection")).toContainText("캐릭터의 표정 이미지에 적용했습니다.");
  expect(errors).toEqual([]);
});

test("epilogues change background at the authored lines in editor and player", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/studio.html"); await page.getByTestId("workspace-stage").click();
  await page.getByTestId("studio-scene-s17b").click();
  await page.getByTestId("studio-line-23").click();
  await expect(page.getByTestId("studio-line-background")).toHaveValue("/assets/art/morning-cafe.png");
  await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/morning-cafe.png");
  await page.getByTestId("studio-play").click();
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/morning-cafe.png");
  await expect(page.getByTestId("dialogue-text")).toHaveText(script.scenes.find(scene=>scene.id==="s17b")!.lines[23]!.text);
  await page.screenshot({ path:"evidence/rain-novel/morning-cafe.png" });
  for(let index=23; index<28; index++) {
    await page.getByTestId("advance-button").click();
    await expect.poll(async() => (await page.evaluate(()=>window.__vn))?.lineIndex).toBe(index+1);
    await expect(page.getByTestId("dialogue-text")).toHaveText(script.scenes.find(scene=>scene.id==="s17b")!.lines[index+1]!.text);
  }
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/riverside-morning.png");
  await page.screenshot({ path:"evidence/rain-novel/riverside-epilogue.png" });
});

test("mobile player keeps full dialogue and navigation reachable", async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto("/");
  await expect(page.getByTestId("start-button")).toBeInViewport();
  await page.screenshot({path:"evidence/rain-novel/title-mobile.png"});
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("dialogue-text")).toHaveText(script.scenes[0]!.lines[0]!.text);
  await expect(page.getByTestId("sprite-right")).toHaveAttribute("data-loaded","true");
  await expect(page.getByTestId("dialogue-box")).toBeInViewport();
  await expect(page.getByTestId("settings-button")).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"evidence/rain-novel/player-mobile.png"});
});
