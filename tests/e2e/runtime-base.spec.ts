import { test, expect, chromium, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { parseScript, type VnScript } from "../../packages/content/src/index.js";

const evidence = resolve(process.env.VNMAKER_RUNTIME_BASE_EVIDENCE ?? "test-results/runtime-base");
const dist = resolve("packages/app/dist");
const files = new Map<string, Uint8Array>();
const requests: { readonly path: string; readonly status: number }[] = [];
const cleanup: string[] = [];
const firstText = "The same manuscript plays inside either package base.";
let origin = "";
let manuscript: VnScript;
let voicePath = "";
const encode = (value: string) => Buffer.from(value);
const types: Readonly<Record<string, string>> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const server = createServer((request, response) => {
  void (async () => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const local = path.replace(/^\/games\/medium\//, "/").replace(/^\/invalid\//, "/");
    let bytes = files.get(local === "/" ? "/index.html" : local);
    if (path === "/invalid/project.json") bytes = encode(JSON.stringify({ ...manuscript, scenes: [{ id: "first", background: "title", backgroundUrl: "../outside.png", lines: [{ speaker: null, text: firstText }] }] }));
    if (path === "/api/image/file/ending-cg.png") bytes = await readFile(resolve(dist, "assets/art/seorin-neutral.png"));
    if (path === "/api/image/file/runtime-base.png") bytes = await readFile(resolve(dist, "assets/art/nocturne-atrium.png"));
    if (!bytes) {
      const absolute = resolve(dist, `.${path}`);
      if (absolute.startsWith(dist + sep)) {
        try { bytes = await readFile(absolute); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      }
    }
    const status = bytes ? 200 : 404;
    requests.push({ path, status });
    response.writeHead(status, { "Content-Type": types[extname(local)] ?? "text/html", "Cache-Control": "no-store" }).end(bytes ?? "Not found");
  })().catch((error: unknown) => { response.writeHead(500).end(String(error)); });
});

test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  const runtime = resolve(dist, "export-runtime");
  const names = await readdir(runtime);
  const entry = names.find(name => /^player-.*\.js$/.test(name));
  assert.ok(entry, "Build the app before running the standalone runtime test");
  for (const name of names) files.set(`/${name}`, await readFile(resolve(runtime, name)));
  const voice = await readFile(resolve("packages/app/test/fixtures/audio-tone.ogg"));
  voicePath = `/assets/user/${createHash("sha256").update(voice).digest("hex")}.ogg`;
  files.set(voicePath, voice);
  manuscript = parseScript({
    title: "Package base regression fixture", subtitle: "Not a production release", start: "first", musicFadeSeconds: 0,
    characters: [
      { id: "seorin", name: "Seorin", bio: "", color: "#ffffff", chromaKey: "#00ff00", expressionImages: { neutral: "/assets/art/seorin-neutral.png" } },
      { id: "mirae", name: "Mirae", bio: "", color: "#ffffff", expressionImages: { neutral: "/assets/sprite/mirae-neutral.png" } },
    ],
    scenes: [{ id: "first", background: "title", bgm: "daily", sprites: [{ slot: "center", character: "seorin" }, { slot: "left", character: "mirae" }],
      lines: [{ speaker: "seorin", text: firstText, backgroundUrl: "/assets/art/nocturne-atrium.png", voice: voicePath, sfx: "page-turn" }], ending: "Fixture end" }],
  });
  files.set("/studio-player.html", await readFile(resolve(dist, "index.html")));
  files.set("/project.json", encode(JSON.stringify(manuscript)));
  files.set("/bundle.json", encode(JSON.stringify({ projectNamespace: "bundle-0123456789abcdef" })));
  files.set("/index.html", encode(`<!doctype html><html><head><meta charset="utf-8">${names.filter(name => name.endsWith(".css")).map(name => `<link rel="stylesheet" href="./${name}">`).join("")}</head><body><div id="root"></div><script type="module" src="./${entry}"></script></body></html>`));
  // Only explicit fixture media is mounted at the nested package; no API/server fallback.
  for (const path of ["assets/bg/title.png", "assets/art/nocturne-atrium.png", "assets/art/seorin-neutral.png", "assets/sprite/mirae-neutral.png", "assets/audio/bgm/daily.mp3", "assets/audio/bgm/main-theme.mp3", "assets/audio/sfx/page-turn.mp3", "assets/audio/sfx/ui-click.mp3"]) files.set(`/${path}`, await readFile(resolve(dist, path)));
  await writeFile(resolve(evidence, "fixture-project.json"), JSON.stringify(manuscript, null, 2));
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(Number(process.env.VNMAKER_RUNTIME_BASE_PORT ?? 0), "127.0.0.1", done); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  await writeFile(resolve(evidence, "server.json"), JSON.stringify({ origin, pid: process.pid, worktree: process.cwd(), runtime, entry }, null, 2));
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await writeFile(resolve(evidence, "server-requests.json"), JSON.stringify(requests, null, 2));
  await writeFile(resolve(evidence, "cleanup.json"), JSON.stringify({ serverClosed: true, browserReceipts: cleanup }, null, 2));
});

async function instrument(page: Page) {
  await page.addInitScript(text => {
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5, bgmVolume: .5, sfxVolume: .5, voiceVolume: .5 }));
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      this.addEventListener("playing", () => console.debug(`runtime-qa:audio:${new URL(this.currentSrc).pathname}`), { once: true });
      return play.call(this);
    };
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement && event.target.naturalWidth > 0) console.debug(`runtime-qa:image:${event.target.dataset["testid"] ?? event.target.className}:${new URL(event.target.src).pathname}`);
    }, true);
    const observer = new MutationObserver(() => {
      const dialogue = document.querySelector('[data-testid="dialogue-text"]');
      if (dialogue?.textContent === text) console.debug("runtime-qa:dialogue");
      if (document.querySelector(".next-mark")) console.debug("runtime-qa:advance-ready");
      if (document.querySelector('[data-testid="ending-screen"]')) console.debug("runtime-qa:ending");
      const canvas = document.querySelector('[data-testid="sprite-center"][data-loaded="true"]');
      if (canvas) console.debug("runtime-qa:canvas");
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-loaded"] });
  }, firstText);
}

for (const base of ["/", "/games/medium/"]) {
  test(`package media plays when the exported runtime is mounted at ${base}`, async () => {
    // Given: an isolated browser, the real built runtime, identical manuscript/media.
    const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const label = base === "/" ? "root" : "subpath";
    const page = await context.newPage();
    const network: string[] = [], errors: string[] = [], actions: string[] = [];
    page.on("request", request => network.push(request.url()));
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.text().startsWith("runtime-qa:")) actions.push(message.text()); });
    await instrument(page);
    try {
      const cover = page.waitForEvent("console", { predicate: message => message.text() === `runtime-qa:image:bg-image:${base}assets/bg/title.png` });
      actions.push(`navigate ${origin}${base}`);
      await page.goto(origin + base); await cover;
      // Subscribe to real decoded-image, GPU canvas, dialogue and playback signals before starting.
      const signals = ["runtime-qa:dialogue", "runtime-qa:canvas", `runtime-qa:image:bg-image:${base}assets/art/nocturne-atrium.png`, `runtime-qa:image:sprite-left:${base}assets/sprite/mirae-neutral.png`, ...["assets/audio/bgm/daily.mp3", "assets/audio/sfx/ui-click.mp3", "assets/audio/sfx/page-turn.mp3", voicePath.slice(1)].map(path => `runtime-qa:audio:${base}${path}`)];
      const observed = Promise.all(signals.map(signal => page.waitForEvent("console", { predicate: message => message.text() === signal })));
      // When: the player starts through its real title control.
      actions.push("click [data-testid=start-button]");
      await page.getByTestId("start-button").click(); await observed;
      // Then: pixels and all audio kinds load from this package, with no fallback or script errors.
      expect(await page.getByTestId("dialogue-text").textContent()).toBe(firstText);
      for (const id of ["bg-image", "sprite-left"]) expect(await page.getByTestId(id).evaluate(node => node instanceof HTMLImageElement && node.naturalWidth > 0 && node.naturalHeight > 0)).toBe(true);
      expect(await page.getByTestId("sprite-center").getAttribute("data-loaded")).toBe("true");
      for (const url of network) { expect(new URL(url).origin).toBe(origin); expect(new URL(url).pathname.startsWith(base)).toBe(true); expect(new URL(url).pathname.includes("/api/")).toBe(false); }
      expect(errors).toEqual([]);
      const saved = await page.evaluate(() => localStorage.getItem("vnmaker:auto:bundle-0123456789abcdef"));
      assert.ok(saved); expect(JSON.parse(saved).script).toEqual(manuscript);
      await page.screenshot({ path: resolve(evidence, `${label}.png`) });
      await writeFile(resolve(evidence, `${label}-network.json`), JSON.stringify(network, null, 2));
      await writeFile(resolve(evidence, `${label}-actions.json`), JSON.stringify({ actions, errors, saveKey: "vnmaker:auto:bundle-0123456789abcdef" }, null, 2));
    } finally {
      await context.close(); await browser.close(); cleanup.push(`${label}: context and Chromium closed`);
    }
  });
}

test("studio generated images stay on their API path when the studio renders a manuscript", async () => {
  // Given: the real studio build and an existing generated image reference.
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await instrument(page);
  await page.addInitScript(source => localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify({ ...source, scenes: source.scenes.map(scene => ({ ...scene, backgroundUrl: "/api/image/file/runtime-base.png", lines: scene.lines.map(line => ({ ...line, backgroundUrl: "/api/image/file/runtime-base.png" })) })) })), manuscript);
  try {
    const loaded = page.waitForEvent("console", { predicate: message => message.text() === "runtime-qa:image:bg-image:/api/image/file/runtime-base.png" });
    // When: opening the studio stage from its real workspace control.
    await page.goto(origin + "/studio.html"); await page.getByTestId("workspace-stage").click(); await loaded;
    // Then: the API path remains unchanged and decoded image pixels are visible.
    const image = page.getByTestId("studio-stage").getByTestId("bg-image");
    expect(await image.getAttribute("src")).toBe("/api/image/file/runtime-base.png");
    expect(await image.evaluate(node => node instanceof HTMLImageElement && node.naturalWidth > 0)).toBe(true);
    expect(errors).toEqual([]); await page.screenshot({ path: resolve(evidence, "studio.png") });
    await writeFile(resolve(evidence, "studio-actions.json"), JSON.stringify({ actions: ["navigate /studio.html", "click [data-testid=workspace-stage]"], src: await image.getAttribute("src"), errors }, null, 2));
  } finally { await context.close(); await browser.close(); cleanup.push("studio: context and Chromium closed"); }
});

test("malformed exported paths fail before media requests when a package escapes its root", async () => {
  // Given: an isolated browser and a traversal-bearing project fixture.
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  const media: string[] = [], errors: string[] = [];
  page.on("request", request => { if (["image", "media"].includes(request.resourceType())) media.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  try {
    // When: the real export entry parses the untrusted project.
    await page.goto(origin + "/invalid/");
    await expect(page.locator("#root > h1")).toBeVisible();
    // Then: boot stops before title/media rendering; no external or API fallback occurs.
    expect(await page.getByTestId("start-button").count()).toBe(0); expect(media).toEqual([]); expect(errors).toEqual([]);
    await page.screenshot({ path: resolve(evidence, "rejected.png") });
    await writeFile(resolve(evidence, "rejected-actions.json"), JSON.stringify({ media, errors, outcome: "boot rejected traversal" }, null, 2));
  } finally { await context.close(); await browser.close(); cleanup.push("rejected: context and Chromium closed"); }
});

for (const base of ["/", "/games/medium/", "/studio-player.html?preview=1"]) {
  const studio = base.includes("preview=1");
  const backgroundUrl = studio ? "/api/image/file/runtime-base.png" : "/assets/art/nocturne-atrium.png";
  const cgUrl = studio ? "/api/image/file/ending-cg.png" : "/assets/art/seorin-neutral.png";
  for (const { variant, art, selected } of [
    { variant: "cg", art: { backgroundUrl, cgUrl }, selected: cgUrl },
    { variant: "background", art: { backgroundUrl }, selected: backgroundUrl },
    { variant: "fallback", art: {}, selected: "/assets/bg/title.png" },
  ]) {
    test(`ending-root-and-subpath selects ${variant} when played at ${base}`, async ({ page }) => {
      // Given: distinct CG/background/fallback choices in the real built player.
      const source = parseScript({ ...manuscript, characters: [], scenes: [{ id: "first", background: "title", ...art,
        lines: [{ speaker: null, text: firstText }], ending: "Fixture end" }] });
      const expected = studio ? selected : base + selected.slice(1);
      const label = `ending-${studio ? "studio" : base === "/" ? "root" : "subpath"}-${variant}`;
      // The runner owns tracing and resource teardown, including setup failures.
      page.context().once("close", () => cleanup.push(`${label}: runner-owned context closed`));
      const network: string[] = [], media: string[] = [], errors: string[] = [], actions: string[] = [];
      page.on("request", request => { network.push(request.url()); if (["image", "media"].includes(request.resourceType())) media.push(request.url()); });
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.text().startsWith("runtime-qa:")) actions.push(message.text()); });
      let actual: string | null = null;
      try {
        await instrument(page);
        files.set("/project.json", encode(JSON.stringify(source)));
        if (studio) await page.addInitScript(script => sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(script)), source);
        const ready = page.waitForEvent("console", { predicate: message => message.text() === "runtime-qa:advance-ready", timeout: 15_000 });
        actions.push(`navigate ${origin}${base}`); await page.goto(origin + base);
        if (!studio) { actions.push("click [data-testid=start-button]"); await page.getByTestId("start-button").click(); }
        await ready;
        // Subscribe before advancing; accept the actual path so RED reports a path mismatch, not a timeout.
        const ending = page.waitForEvent("console", { predicate: message => message.text() === "runtime-qa:ending", timeout: 15_000 });
        const loaded = page.waitForEvent("console", { predicate: message => message.text().startsWith("runtime-qa:image:ending-bg:"), timeout: 15_000 });
        const endingMediaStart = media.length;
        // When: advancing the finished dialogue into its ending through the player control.
        actions.push("click [data-testid=advance-button]"); await page.getByTestId("advance-button").click();
        await Promise.all([ending, loaded]);
        // Then: the selected ending image decodes at exactly the package-owned (or unchanged studio) path.
        const image = page.locator(".ending-bg"); actual = await image.getAttribute("src");
        await page.screenshot({ path: resolve(evidence, `${label}.png`) });
        await writeFile(resolve(evidence, `${label}-result.json`), JSON.stringify({ expected, actual, endingMedia: media.slice(endingMediaStart) }, null, 2));
        expect(actual).toBe(expected);
        expect(await image.evaluate(node => node instanceof HTMLImageElement && node.naturalWidth > 0 && node.naturalHeight > 0)).toBe(true);
        expect(await page.getByTestId("ending-screen").count()).toBe(1);
        for (const url of media) { expect(new URL(url).origin).toBe(origin); if (!studio) expect(new URL(url).pathname.startsWith(base)).toBe(true); }
        expect(media.map(url => new URL(url).pathname)).toContain(expected);
        expect(errors).toEqual([]);
      } finally {
        files.set("/project.json", encode(JSON.stringify(manuscript)));
        await writeFile(resolve(evidence, `${label}-network.json`), JSON.stringify(network, null, 2));
        await writeFile(resolve(evidence, `${label}-actions.json`), JSON.stringify({ actions, errors, expected, actual }, null, 2));
      }
    });
  }
}
