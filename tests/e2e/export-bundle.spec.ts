import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { script, type VnScript } from "../../packages/content/src/index.js";
import { registerLongformExportTests } from "./helpers/longform-export.js";
import type {} from "../../packages/app/src/App.js";

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
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(async value => {
    const path = "/src/studio/projects.ts";
    const { saveProject, activateProject }: typeof import("../../packages/app/src/studio/projects.js") = await import(path);
    const id = crypto.randomUUID();
    await saveProject(id, value);
    activateProject(id, value);
    localStorage.removeItem("vnmaker.studio.position.v1");
  }, source);
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
// Each signal is subscribed before its user action. The accessor observes the existing
// diagnostic publication without changing the reducer, timers or persistence behavior.
function publishedVn(text: string) {
  const match = /^export:state:([^:]+):([^:]+):(\d+):(true|false)$/.exec(text);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return;
  return { phase: match[1], sceneId: match[2], lineIndex: Number(match[3]), typing: match[4] === "true" };
}
type PublishedVn = { phase: string; sceneId: string; lineIndex: number; typing: boolean };
const publishedLatest = new WeakMap<Page, { sample?: PublishedVn }>();
const waitUntilLive = { listeners: 0, timers: 0 };
function waitForPublishedVn(page: Page, predicate: (sample: PublishedVn) => boolean) {
  return page.waitForEvent("console", {
    timeout: 15_000,
    predicate: message => {
      const sample = publishedVn(message.text());
      return !!sample && predicate(sample);
    },
  });
}
function publishedSample(page: Page) {
  return publishedLatest.get(page)?.sample;
}
function waitUntilPublishedVn(page: Page, predicate: (sample: PublishedVn) => boolean) {
  // observeExportPlayer writes the retained sample synchronously on the same
  // console emit, before later listeners run. A matching sample is current
  // state: return without a waiter. Otherwise attach, then read the sample
  // again so an emit between the first read and attach cannot be lost. finish()
  // always removes the listener and timer; nothing is swallowed.
  const current = publishedSample(page);
  if (current && predicate(current)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    waitUntilLive.listeners += 1;
    waitUntilLive.timers += 1;
    const timer = setTimeout(() => finish(new Error("Timeout 15000ms exceeded while waiting on the published player state")), 15_000);
    function onConsole(message: { text(): string }) {
      const sample = publishedVn(message.text());
      if (sample && predicate(sample)) finish();
    }
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waitUntilLive.timers -= 1;
      page.off("console", onConsole);
      waitUntilLive.listeners -= 1;
      if (error) reject(error);
      else resolve();
    }
    page.on("console", onConsole);
    const again = publishedSample(page);
    if (again && predicate(again)) finish();
  });
}
async function observeExportPlayer(page: Page, firstLine: string) {
  const latest: { sample?: PublishedVn } = {};
  publishedLatest.set(page, latest);
  page.on("console", message => {
    const sample = publishedVn(message.text());
    if (sample) latest.sample = sample;
  });
  await page.addInitScript(line => {
    let published: Window["__vn"];
    Object.defineProperty(window, "__vn", {
      configurable: true, get: () => published,
      set: (value: NonNullable<Window["__vn"]>) => {
        published = value;
        console.debug(`export:state:${value.phase}:${value.sceneId}:${value.lineIndex}:${value.typing}`);
      },
    });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      setItem.call(this, key, value);
      if (this === localStorage && key.startsWith("vnmaker:auto:")) console.debug(`export:autosaved:${key}:${value.includes(line) ? "first-line" : "other"}`);
    };
  }, firstLine);
}
async function advance(page: Page, index: number) {
  await waitUntilPublishedVn(page, sample => sample.typing === false);
  const progressed = waitForPublishedVn(page, sample => sample.lineIndex === index);
  await Promise.all([progressed, page.getByTestId("advance-button").click()]);
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
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
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
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
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
    await observeExportPlayer(player, firstLine);
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
    const autoSaved = player.waitForEvent("console", { timeout: 15_000, predicate: message => message.text() === `export:autosaved:vnmaker:auto:${manifest.projectNamespace}:first-line` });
    await player.getByTestId("start-button").click();
    await expect(player.getByTestId("dialogue-text")).toHaveText(firstLine);
    await waitUntilPublishedVn(player, sample => sample.typing === false);
    const readyLive = { listeners: waitUntilLive.listeners, timers: waitUntilLive.timers };
    await waitUntilPublishedVn(player, sample => sample.typing === false);
    expect(waitUntilLive.listeners).toBe(readyLive.listeners);
    expect(waitUntilLive.timers).toBe(readyLive.timers);
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
    await autoSaved;
    expect(await player.evaluate(namespace => localStorage.getItem(`vnmaker:auto:${namespace}`), manifest.projectNamespace)).toContain(firstLine);
    await player.reload(); await expect(player.getByTestId("continue-button")).toBeEnabled();
    const restored = waitForPublishedVn(player, sample => sample.lineIndex === 1);
    await Promise.all([restored, player.getByTestId("continue-button").click()]);
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

test("exported player observer does not succeed without a published lineIndex change", async ({ page }) => {
  await observeExportPlayer(page, "ZIP 다운로드 직전에 고친 첫 번째 대사다.");
  await page.goto("about:blank");
  const progressed = waitForPublishedVn(page, sample => sample.lineIndex === 2);
  await page.mouse.click(1, 1);
  let succeeded = false;
  try {
    await progressed;
    succeeded = true;
  } catch (error) {
    expect(String(error)).toMatch(/Timeout 15000ms/);
  }
  expect(succeeded).toBe(false);
});

registerLongformExportTests(installProject, unzip, serve);
