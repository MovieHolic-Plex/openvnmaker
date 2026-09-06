import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { script, applyChoiceFlags, choiceAllowed, lineAllowed, type StoryFlags, type VnScript } from "../../packages/content/src/index.js";

const fixture: VnScript = {
  title: "ZIP 검증 초안", subtitle: "현재 편집본으로 독립 실행", start: "export-start",
  characters: script.characters.map(character => ({ ...character, expressionImages: { neutral: `/assets/art/${character.id}-neutral.png` } })),
  assets: [{ id: "portable-art", kind: "background", name: "현재 작품의 이미지", url: "/api/image/file/export-cover.png" }],
  scenes: [
    { id: "export-start", chapter: "편집한 첫 장면", background: "title", backgroundUrl: "/api/image/file/export-cover.png", bgm: "daily", lines: [
      { speaker: null, text: "바꾸기 전 대사" },
      { speaker: "seorin", text: "새로운 서버에서도 같은 장면이 이어진다.", backgroundUrl: "/assets/art/atelier-golden-hour.png", bgm: "rain", sprites: [{ slot: "center", character: "seorin", poseUrl: "/api/image/file/export-pose.png" }], sfx: "page-turn" },
      { speaker: null, text: "기억해 둔 작은 유리 조각.", cgUrl: "/api/image/file/export-cg.png", framing: "cinematic" },
      { speaker: null, text: "그림을 내려놓고 음악을 멈춘다.", cgUrl: null, bgm: null, sprites: [{ slot: "center", character: null }] },
    ], choices: [{ text: "이 장면을 기억한다", next: "export-end", set: { remembered: true } }] },
    { id: "export-end", chapter: "마지막 장면", background: "title", backgroundUrl: "/assets/art/atelier-golden-hour.png", bgm: "ending", lines: [{ speaker: null, text: "현재 원고에 쓰인 정확한 결말.", when: { all: ["remembered"] } }], ending: "수정본의 독립 엔딩" },
  ],
};

async function installProject(page: Page, source: VnScript = fixture) {
  await page.goto("/studio.html");
  await page.evaluate(value => { localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(value)); localStorage.removeItem("vnmaker.studio.position.v1"); }, source);
  await page.reload();
  await expect(page.getByLabel("작품 제목")).toHaveValue(source.title);
}
async function generatedFiles(page: Page) {
  const mapping: Record<string, string> = { "export-cover.png": "nocturne-atrium.png", "export-pose.png": "seorin-neutral.png", "export-cg.png": "blue-pigment-cg.png" };
  await page.route("**/api/image/file/export-*.png", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
    await route.fulfill({ contentType: "image/png", body: await readFile(resolve("packages/app/public/assets/art", mapping[name]!)) });
  });
}
async function advance(page: Page, index: number) {
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(index);
}
async function unzip(zip: string, destination: string) {
  await mkdir(destination, { recursive: true });
  if (process.platform === "win32") execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:VN_TEST_ZIP -DestinationPath $env:VN_TEST_OUTPUT -Force"], { env: { ...process.env, VN_TEST_ZIP: zip, VN_TEST_OUTPUT: destination } });
  else execFileSync("unzip", ["-q", zip, "-d", destination]);
}
async function serve(directory: string): Promise<{ server: Server; origin: string; missing: string[] }> {
  const missing: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const path = resolve(directory, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
      if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
      try {
        await stat(path);
        const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".mp3": "audio/mpeg", ".webp": "image/webp" };
        response.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
        response.setHeader("Cache-Control", "no-store"); response.end(await readFile(path));
      } catch { if (url.pathname !== "/favicon.ico") missing.push(url.pathname); response.writeHead(404).end("not found"); }
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server failed");
  return { server, origin: `http://127.0.0.1:${address.port}`, missing };
}

test("download edited project ZIP, unzip, and play its assets and isolated saves on another origin", async ({ page, browser }, testInfo) => {
  await generatedFiles(page);
  await installProject(page);
  const title = "지금 수정한 독립 작품";
  await page.getByTestId("workspace-assets").click();
  await page.getByTestId("art-card-portable-art").click();
  await page.locator(".art-workbench .media-provenance summary").click();
  await page.getByLabel("제작자", {exact:true}).fill("출처 검증용 제작자");
  await page.getByLabel("출처·구매 내역", {exact:true}).fill("직접 제작 · 제작 기록 001");
  await page.getByLabel("이용 조건·라이선스", {exact:true}).fill("테스트용 이용 조건");
  await page.getByLabel("크레딧 표기문", {exact:true}).fill("Artwork by 테스트 제작자");
  await page.screenshot({path:testInfo.outputPath("media-provenance-desktop.png")});
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel("크레딧 표기문", {exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath("media-provenance-mobile.png")});
  await page.setViewportSize({width:1280,height:720});
  await page.reload();
  await page.getByTestId("workspace-assets").click();
  await page.getByTestId("art-card-portable-art").click();
  await expect(page.getByLabel("제작자", {exact:true})).toHaveValue("출처 검증용 제작자");
  await page.getByTestId("workspace-overview").click();
  const team=page.getByTestId("team-credits-editor");
  await team.getByRole("button",{name:"제작진 항목 추가"}).click();
  await page.getByLabel("제작진 1 역할",{exact:true}).fill("시나리오"); await page.getByLabel("제작진 1 이름",{exact:true}).fill("한나\n도윤");
  await team.getByRole("button",{name:"제작진 항목 추가"}).click();
  await page.getByLabel("제작진 2 역할",{exact:true}).fill("음악"); await page.getByLabel("제작진 2 이름",{exact:true}).fill("미솔");
  await page.getByRole("button",{name:"제작진 2 위로",exact:true}).click(); await expect(page.getByLabel("제작진 1 역할",{exact:true})).toHaveValue("음악");
  await page.getByRole("button",{name:"제작진 1 삭제",exact:true}).click(); await expect(page.getByLabel("제작진 1 역할",{exact:true})).toHaveValue("시나리오");
  await team.scrollIntoViewIfNeeded(); await page.screenshot({path:testInfo.outputPath("team-credits-editor.png")});
  await page.setViewportSize({width:390,height:844});await team.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("team-credits-editor-mobile.png")});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:720});
  await page.reload(); await page.getByTestId("workspace-overview").click(); await expect(page.getByLabel("제작진 1 이름",{exact:true})).toHaveValue("한나\n도윤");
  const firstLine = "ZIP 다운로드 직전에 고친 첫 번째 대사다.";
  await page.getByLabel("작품 제목").fill(title);
  await page.getByTestId("workspace-stage").click();
  await page.getByTestId("studio-line-0").click();
  await page.getByTestId("studio-line-text").fill(firstLine);
  await page.getByTestId("studio-export-bundle").click();
  await expect(page.getByTestId("export-bundle-dialog")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("export-dialog.png") });
  const downloaded = page.waitForEvent("download");
  await page.getByTestId("export-bundle-build").click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(`${title}-play.zip`);
  const zipPath = testInfo.outputPath("game.zip"); await download.saveAs(zipPath);
  await expect(page.getByTestId("export-bundle-success")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("export-complete.png") });
  const directory = testInfo.outputPath("unpacked"); await unzip(zipPath, directory);
  const components = JSON.parse(await readFile(resolve(directory, "RUNTIME_COMPONENTS.json"), "utf8"));
  expect(components.components.map((component: { name: string }) => component.name)).toEqual(["react", "react-dom", "rolldown", "scheduler", "vnmaker"]);
  const notices = await readFile(resolve(directory, "THIRD_PARTY_NOTICES.txt"), "utf8");
  expect(notices).toContain("THIRD-PARTY-LICENSE");
  expect(notices).toContain(await readFile(resolve("packages/app/node_modules/react/LICENSE"), "utf8"));
  const projectText = await readFile(resolve(directory, "project.json"), "utf8"); const exported = JSON.parse(projectText) as VnScript;
  expect(exported.assets![0]!.provenance?.creator).toBe("출처 검증용 제작자");
  const credits=JSON.parse(await readFile(resolve(directory,"MEDIA_CREDITS.json"),"utf8"));
  expect(credits.files.find((file:{path:string})=>file.path===exported.assets![0]!.url).status).toBe("recorded");
  expect(credits.files.find((file:{path:string})=>file.path==="/assets/audio/sfx/ui-click.mp3").status).toBe("needs-record");
  expect(await readFile(resolve(directory,"MEDIA_CREDITS.txt"),"utf8")).toContain("Artwork by 테스트 제작자");
  const manifest = JSON.parse(await readFile(resolve(directory, "bundle.json"), "utf8")) as { projectNamespace: string; files: { path: string }[] };
  expect(exported.title).toBe(title); expect(exported.scenes[0]?.lines[0]?.text).toBe(firstLine); expect(projectText).not.toContain("/api/image/file/");
  expect(exported.credits).toEqual([{role:"시나리오",names:"한나\n도윤"}]);
  const runtimePath = manifest.files.find(file => file.path.startsWith("player-") && file.path.endsWith(".js"))!.path;
  const runtime = await readFile(resolve(directory, runtimePath), "utf8");
  expect(runtime).not.toContain(script.scenes[0]!.lines[0]!.text); // Build-default manuscript cannot leak into the export runtime.
  for (const file of manifest.files) expect((await stat(resolve(directory, file.path))).size).toBeGreaterThan(0);
  const hosting = await serve(directory); const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(()=>localStorage.setItem("vnmaker:settings",JSON.stringify({textSpeed:5,bgmVolume:.55,sfxVolume:.7,voiceVolume:.8})));
  try {
    const player = await context.newPage(); const external: string[] = []; const pageErrors: string[] = [];
    player.on("request", request => { const url = new URL(request.url()); if (url.origin !== hosting.origin || url.pathname.startsWith("/api/")) external.push(url.href); });
    player.on("pageerror", error => pageErrors.push(error.message));
    await player.addInitScript(oldScript => {
      localStorage.setItem("vnmaker:save", JSON.stringify({ script: oldScript, sceneId: oldScript.start, lineIndex: 0, affection: 99, savedAt: Date.now() }));
      localStorage.setItem("vnmaker:auto:bundle-0000000000000000", JSON.stringify({ script: oldScript, sceneId: oldScript.start, lineIndex: 0, affection: 99, savedAt: Date.now() }));
      localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5, bgmVolume: .3, sfxVolume: .3 }));
      sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(oldScript));
    }, script);
    await player.goto(`${hosting.origin}/?preview=1`);
    await expect(player.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(player.getByTestId("continue-button")).toBeDisabled();
    await expect(player.getByTestId("studio-button")).toHaveCount(0);
    await player.getByTestId("credits-button").click();
    const creditPanel = player.getByTestId("credits-panel");
    await expect(creditPanel).toContainText("Artwork by 테스트 제작자");
    await expect(creditPanel.locator(".team-credits")).toContainText("시나리오");await expect(creditPanel.locator(".team-credits")).toContainText("한나\n도윤");
    await expect(creditPanel).toContainText("테스트용 이용 조건");
    await expect(creditPanel).not.toContainText("제작 기록 001");
    const notices = await context.request.get(`${hosting.origin}/THIRD_PARTY_NOTICES.txt`);
    expect(notices.ok()).toBe(true); expect(await notices.text()).toContain("MIT");
    await player.screenshot({path:testInfo.outputPath("runtime-credits-desktop.png")});
    await player.setViewportSize({width:390,height:844});
    await player.screenshot({path:testInfo.outputPath("runtime-credits-mobile.png")});
    expect(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await player.keyboard.press("Escape"); await expect(creditPanel).not.toBeVisible();
    await expect(player.getByTestId("credits-button")).toBeFocused();
    await player.setViewportSize({width:1440,height:900});
    await player.getByTestId("start-button").click();
    await expect(player.getByTestId("dialogue-text")).toHaveText(firstLine);
    await player.getByTestId("settings-button").focus(); await player.keyboard.press("Enter");
    await expect(player.getByTestId("settings-panel")).toBeVisible();
    await expect(player.getByRole("dialog", {name:"플레이 설정",exact:true})).toBeVisible();
    await expect(player.getByTestId("settings-panel").getByRole("button",{name:"닫기",exact:true})).toBeFocused();
    expect(await player.evaluate(()=>window.__vn?.lineIndex)).toBe(0);
    await player.getByTestId("credits-button").click();
    await expect(creditPanel).toContainText("Artwork by 테스트 제작자");
    await player.keyboard.press("Enter"); await expect(creditPanel).not.toBeVisible();
    expect(await player.evaluate(()=>window.__vn?.lineIndex)).toBe(0);
    await expect(player.getByTestId("bg-image")).toHaveAttribute("src", /^\/assets\/exported\//);
    await advance(player, 1);
    await player.getByTestId("history-button").focus(); await player.keyboard.press("Enter");
    const historyPanel = player.getByRole("dialog",{name:"대사 기록",exact:true});
    await expect(historyPanel).toBeVisible(); await expect(historyPanel).toContainText(firstLine);
    await expect(historyPanel.getByTestId("backlog-chapter")).toHaveText(exported.scenes[0]!.chapter || exported.scenes[0]!.id);
    await expect(player.getByTestId("backlog-close")).toBeFocused();
    await player.keyboard.press("Escape"); await expect(player.getByTestId("history-button")).toBeFocused();
    expect(await player.evaluate(()=>window.__vn?.lineIndex)).toBe(1);
    await expect(player.getByTestId("bg-image")).toHaveAttribute("src", "/assets/art/atelier-golden-hour.png");
    await expect(player.getByTestId("sprite-center")).toHaveAttribute("data-src", /^\/assets\/exported\//);
    await expect(player.getByTestId("bgm-audio")).toHaveAttribute("src", "/assets/audio/bgm/rain.mp3");
    await expect.poll(() => player.getByTestId("bgm-audio").evaluate(audio => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
    await expect.poll(() => player.evaluate(namespace => localStorage.getItem(`vnmaker:auto:${namespace}`), manifest.projectNamespace)).toContain(firstLine);
    await player.reload(); await expect(player.getByTestId("continue-button")).toBeEnabled(); await player.getByTestId("continue-button").click();
    await expect.poll(() => player.evaluate(() => window.__vn?.lineIndex)).toBe(1);
    await advance(player, 2);
    await expect(player.getByTestId("bg-image")).toHaveAttribute("src", /^\/assets\/exported\//);
    await expect(player.locator(".sprite")).toHaveCount(0);
    await player.screenshot({ path: testInfo.outputPath("standalone-cg.png") });
    await advance(player, 3); await expect(player.locator(".sprite")).toHaveCount(0);
    await player.getByTestId("skip-button").click(); await expect(player.getByTestId("choice-0")).toBeFocused(); await player.keyboard.press("1");
    await expect(player.getByTestId("dialogue-text")).toHaveText("현재 원고에 쓰인 정확한 결말.");
    await player.getByTestId("skip-button").click(); await expect(player.getByTestId("ending-title")).toHaveText("수정본의 독립 엔딩");
    await player.getByTestId("credits-button").click(); await expect(creditPanel).toContainText("Artwork by 테스트 제작자");
    await creditPanel.getByRole("button",{name:"닫기"}).click(); await expect(player.getByTestId("ending-title")).toHaveText("수정본의 독립 엔딩");
    await player.screenshot({ path: testInfo.outputPath("standalone-ending.png") });
    await player.getByTestId("back-to-title").click(); await expect(player.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(await player.evaluate(() => JSON.parse(localStorage.getItem("vnmaker:save")!).script.title)).toBe(script.title);
    expect(external).toEqual([]); expect(hosting.missing).toEqual([]); expect(pageErrors).toEqual([]);
  } finally { await context.close(); await new Promise<void>(resolve => hosting.server.close(() => resolve())); }
  const restoredContext=await browser.newContext();
  try {
    const restored=await restoredContext.newPage();await restored.goto(`${new URL(page.url()).origin}/studio.html`);
    await restored.getByTestId("project-library").click();await restored.getByTestId("project-restore-file").setInputFiles(zipPath);
    await expect(restored.getByLabel("작품 제목")).toHaveValue(title);await restored.getByTestId("workspace-overview").click();
    await expect(restored.getByLabel("제작진 1 이름",{exact:true})).toHaveValue("한나\n도윤");await expect(restored.getByLabel("제작진 1 역할",{exact:true})).toHaveValue("시나리오");
  } finally {await restoredContext.close();}
});

test("a missing image prevents ZIP download and names the exact asset", async ({ page }) => {
  await generatedFiles(page);
  const missing = "/assets/art/export-missing-image.png";
  await installProject(page, { ...fixture, scenes: fixture.scenes.map((scene, index) => index ? scene : { ...scene, backgroundUrl: missing }) });
  let downloads = 0; page.on("download", () => { downloads += 1; });
  await page.getByTestId("studio-export-bundle").click(); await page.getByTestId("export-bundle-build").click();
  await expect(page.getByTestId("export-bundle-error")).toContainText(missing);
  await expect(page.getByTestId("export-bundle-build")).toBeEnabled(); expect(downloads).toBe(0);
});

test("cancel a pending export without downloading a partial game, then retry successfully", async ({ page }) => {
  await generatedFiles(page); await installProject(page);
  let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let hold = true;
  await page.route("**/api/image/file/export-cover.png", async route => {
    if (hold) { entered(); await gate; }
    await route.fulfill({ contentType: "image/png", body: await readFile(resolve("packages/app/public/assets/art/nocturne-atrium.png")) }).catch(() => undefined);
  });
  let downloads = 0; page.on("download", () => { downloads += 1; });
  await page.getByTestId("studio-export-bundle").click(); await page.getByTestId("export-bundle-build").click();
  await waiting; await page.getByRole("button", { name: "중단", exact: true }).click();
  hold = false; release();
  await expect(page.getByTestId("export-bundle-build")).toBeEnabled();
  await expect(page.getByTestId("export-bundle-success")).toHaveCount(0); expect(downloads).toBe(0);
  const download = page.waitForEvent("download"); await page.getByTestId("export-bundle-build").click(); await download;
  await expect(page.getByTestId("export-bundle-success")).toBeVisible(); expect(downloads).toBe(1);
});

test("the entire long-form novel exports with all rich art and plays through every route", async ({ page, browser }, testInfo) => {
  test.setTimeout(300000);
  await installProject(page, script);
  await page.getByTestId("studio-export-bundle").click();
  const downloaded = page.waitForEvent("download", { timeout: 90000 }); await page.getByTestId("export-bundle-build").click();
  const download = await downloaded;
  const zipPath = testInfo.outputPath("rain-novel-play.zip"); await download.saveAs(zipPath);
  const directory = testInfo.outputPath("unpacked"); await unzip(zipPath, directory);
  const project = JSON.parse(await readFile(resolve(directory, "project.json"), "utf8")) as VnScript;
  expect(project).toEqual(script);
  expect(project.scenes.length).toBe(20);
  expect(project.scenes.reduce((count, scene) => count + scene.lines.length, 0)).toBe(829);
  expect(project.assets?.length).toBe(35);
  const hosting = await serve(directory); const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(()=>localStorage.setItem("vnmaker:settings",JSON.stringify({textSpeed:5,bgmVolume:.55,sfxVolume:.7,voiceVolume:.8})));
  try {
    const player = await context.newPage(); const errors: string[] = []; const external: string[] = [];
    player.on("pageerror", error => errors.push(error.message));
    player.on("request", request => { const url = new URL(request.url()); if (url.origin !== hosting.origin || url.pathname.startsWith("/api/")) external.push(url.href); });
    await player.goto(hosting.origin); await expect(player.getByRole("heading", { name: script.title, exact: true })).toBeVisible();
    await player.getByTestId("bg-image").evaluate(image => (image as HTMLImageElement).decode());
    await player.screenshot({ path: testInfo.outputPath("longform-standalone-title.png") });
    await player.getByTestId("start-button").click();
    const first = project.scenes.find(scene => scene.id === project.start)!;
    await expect(player.getByTestId("dialogue-text")).toHaveText(first.lines[0]!.text);
    await player.getByTestId("save-button").click(); await player.getByTestId("slot-save-0").click();
    await advance(player, 1);
    await player.getByTestId("save-button").click(); await player.getByTestId("slot-save-1").click();
    await player.getByTestId("load-button").click();
    await player.screenshot({ path: testInfo.outputPath("longform-standalone-slots.png") });
    await player.getByTestId("slot-load-0").click();
    await expect.poll(() => player.evaluate(() => window.__vn?.lineIndex)).toBe(0);
    await expect(player.getByTestId("dialogue-text")).toHaveText(first.lines[0]!.text);
    await player.getByTestId("load-button").click(); await player.getByTestId("slot-load-1").click();
    await expect.poll(() => player.evaluate(() => window.__vn?.lineIndex)).toBe(1);
    await expect(player.getByTestId("dialogue-text")).toHaveText(first.lines[1]!.text);
    await player.getByTestId("auto-button").click(); await player.getByTestId("art-view-button").click();
    await expect(player.getByTestId("dialogue-text")).toHaveCount(0); await expect(player.getByTestId("save-button")).toHaveCount(0);
    await player.screenshot({ path: testInfo.outputPath("longform-standalone-art-view.png") });
    // Wait beyond this line's normal auto-advance deadline; viewing artwork pauses it.
    await player.waitForTimeout(1000 + first.lines[1]!.text.length * 45);
    expect(await player.evaluate(() => window.__vn?.lineIndex)).toBe(1);
    await player.getByTestId("art-view-button").click(); await player.getByTestId("auto-button").click();
    await expect(player.getByTestId("dialogue-text")).toBeVisible();
    const visited = new Set<string>();
    for (let step = 0; step < 30; step++) {
      const state = await player.evaluate(() => window.__vn!); expect(state.error).toBeNull();
      if (state.phase === "ending") break;
      visited.add(state.sceneId);
      if (state.phase === "choice") await player.getByTestId("choice-0").click();
      else await player.getByTestId("skip-button").click();
    }
    await expect(player.getByTestId("ending-title")).toHaveText(script.scenes.find(scene => scene.id === "s17a")!.ending!);
    await player.screenshot({ path: testInfo.outputPath("longform-standalone-ending.png") });
    expect(visited.size).toBe(17); expect(hosting.missing).toEqual([]); expect(errors).toEqual([]); expect(external).toEqual([]);
    // Enumerate every acyclic choice path, then execute each in the actual exported player.
    const routes:{scenes:string[];choices:number[];flags:StoryFlags;ending:string;historyCount:number}[]=[];
    function walk(id:string,flags:StoryFlags,scenes:string[],choices:number[],historyCount:number){
      if(scenes.includes(id))throw new Error("This sample QA requires acyclic routes");
      const scene=project.scenes.find(row=>row.id===id)!;expect(scene).toBeTruthy();
      const path=[...scenes,id],count=historyCount+scene.lines.filter(line=>lineAllowed(line,flags)).length;
      if(scene.choices?.length){
        const allowed=scene.choices.map((choice,index)=>({choice,index})).filter(({choice})=>choiceAllowed(choice,flags));expect(allowed.length).toBeGreaterThan(0);
        for(const {choice,index} of allowed)walk(choice.next,applyChoiceFlags(flags,choice),path,[...choices,index],count+1);
      }else if(scene.ending)routes.push({scenes:path,choices,flags,ending:scene.ending,historyCount:count});
      else {expect(scene.next).toBeTruthy();walk(scene.next!,flags,path,choices,count);}
    }
    walk(project.start,project.flags??{},[],[],0);expect(routes).toHaveLength(8);
    const covered=new Set<string>(),endings=new Set<string>(),report=[];
    for(const [index,route] of routes.entries()){
      await player.setViewportSize(index%2?{width:390,height:844}:{width:1440,height:900});
      await player.reload();await player.getByTestId("start-button").click();let decision=0;
      for(const id of route.scenes){
        await expect.poll(()=>player.evaluate(()=>window.__vn?.sceneId)).toBe(id);
        expect(await player.evaluate(()=>window.__vn?.error)).toBeNull();
        const scene=project.scenes.find(row=>row.id===id)!;
        const currentFlags=await player.evaluate(()=>window.__vn!.flags);
        const firstLine=scene.lines.find(line=>lineAllowed(line,currentFlags));
        await expect(player.getByTestId("dialogue-text")).toHaveText(firstLine!.text);
        if(!covered.has(id)){
          await player.getByTestId("bg-image").evaluate(image=>(image as HTMLImageElement).decode());
          await player.screenshot({path:testInfo.outputPath(`route-scene-${id}.png`)});covered.add(id);
        }
        await player.getByTestId("skip-button").click();
        if(scene.choices?.length){await expect.poll(()=>player.evaluate(()=>window.__vn?.phase)).toBe("choice");await player.getByTestId(`choice-${route.choices[decision++]}`).click();}
      }
      await expect(player.getByTestId("ending-title")).toHaveText(route.ending);
      expect(await player.evaluate(()=>window.__vn!.flags)).toEqual(route.flags);
      expect(await player.evaluate(()=>window.__vn!.error)).toBeNull();
      await player.screenshot({path:testInfo.outputPath(`route-${index+1}-ending.png`)});
      // The ending autosave includes every completed visible line and selected choice.
      await expect.poll(()=>player.evaluate(()=>{
        const key=Object.keys(localStorage).find(key=>key.startsWith("vnmaker:auto:"));
        return key ? JSON.parse(localStorage.getItem(key)!).history?.length : null;
      })).toBe(route.historyCount);
      endings.add(route.ending);report.push({route:index+1,...route});
    }
    expect([...covered].sort()).toEqual(project.scenes.map(scene=>scene.id).sort());expect(endings.size).toBe(2);
    await writeFile(testInfo.outputPath("all-route-report.json"),JSON.stringify(report,null,2));
    expect(hosting.missing).toEqual([]);expect(errors).toEqual([]);expect(external).toEqual([]);

  } finally { await context.close(); await new Promise<void>(resolve => hosting.server.close(() => resolve())); }
});
