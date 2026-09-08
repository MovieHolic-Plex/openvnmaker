import { test as base, expect, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { script, parseScript, applyChoiceFlags, choiceAllowed, lineAllowed, type StoryFlags, type VnScript } from "../../../packages/content/src/index.js";
import type {} from "../../../packages/app/src/App.js";

type Route = { readonly scenes: readonly string[]; readonly choices: readonly number[]; readonly flags: StoryFlags; readonly ending: string; readonly historyCount: number };
type Hosting = { readonly server: Server; readonly origin: string; readonly missing: string[] };
// The oracle is captured from source before test collection, never from the downloaded game.
const source = parseScript(JSON.parse(JSON.stringify(script)));
const routes: Route[] = [];
function walk(id: string, route: Omit<Route, "ending">): void {
  expect(route.scenes).not.toContain(id);
  const scene = source.scenes.find(row => row.id === id);
  if (!scene) throw new Error(`Missing source scene ${id}`);
  const scenes = [...route.scenes, id];
  const historyCount = route.historyCount + scene.lines.filter(line => lineAllowed(line, route.flags)).length;
  if (scene.choices?.length) {
    const allowed = scene.choices.map((choice, index) => ({ choice, index })).filter(({ choice }) => choiceAllowed(choice, route.flags));
    expect(allowed.length).toBeGreaterThan(0);
    for (const { choice, index } of allowed) walk(choice.next, { scenes, choices: [...route.choices, index], flags: applyChoiceFlags(route.flags, choice), historyCount: historyCount + 1 });
  } else if (scene.ending) routes.push(Object.freeze({ ...route, scenes: Object.freeze(scenes), ending: scene.ending, historyCount }));
  else if (scene.next) walk(scene.next, { ...route, scenes, historyCount });
  else throw new Error(`Source scene ${id} has no exit`);
}
walk(source.start, { scenes: [], choices: [], flags: source.flags ?? {}, historyCount: 0 });
Object.freeze(routes);

// Each signal is subscribed before its user action. The accessor observes the existing
// diagnostic publication without changing the reducer, timers or persistence behavior.
async function clickTo(page: Page, button: string, state: string) {
  const observed = page.waitForEvent("console", { predicate: message => message.text() === `longform:state:${state}`, timeout: 15000 });
  const saved = page.waitForEvent("console", { predicate: message => message.text() === "longform:autosaved", timeout: 15000 });
  await Promise.all([observed, saved, page.getByTestId(button).click()]);
}

export function registerLongformExportTests(
  installProject: (page: Page, source: VnScript) => Promise<void>,
  unzip: (zip: string, directory: string) => Promise<void>,
  serve: (directory: string) => Promise<Hosting>,
) {
  const test = base.extend<{ player: Page }, { exported: Hosting & { readonly directory: string } }>({
    exported: [async ({ browser }, use, workerInfo) => {
      const directory = resolve(workerInfo.project.outputDir, `longform-worker-${workerInfo.workerIndex}`);
      await mkdir(directory, { recursive: true });
      const baseURL = workerInfo.project.use.baseURL;
      if (!baseURL) throw new Error("The export fixture requires the studio baseURL");
      const editor = await browser.newContext({ baseURL });
      try {
        const page = await editor.newPage();
        await installProject(page, source);
        await page.getByTestId("studio-export-bundle").click();
        const downloaded = page.waitForEvent("download", { timeout: 90000 });
        await page.getByTestId("export-bundle-build").click();
        const zipPath = resolve(directory, "rain-novel-play.zip");
        await (await downloaded).saveAs(zipPath);
        await unzip(zipPath, directory);
        expect(JSON.parse(await readFile(resolve(directory, "project.json"), "utf8"))).toEqual(source);
      } finally { await editor.close(); }
      const hosting = await serve(directory);
      try { await use({ ...hosting, directory }); }
      finally { await new Promise<void>((resolve, reject) => hosting.server.close(error => error ? reject(error) : resolve())); }
    }, { scope: "worker" }],
    player: async ({ page, exported }, use) => {
      const errors: string[] = [], external: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { const url = new URL(request.url()); if (url.origin !== exported.origin || url.pathname.startsWith("/api/")) external.push(url.href); });
      await page.addInitScript(() => {
        localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5, bgmVolume: .55, sfxVolume: .7, voiceVolume: .8 }));
        let state: Window["__vn"];
        Object.defineProperty(window, "__vn", {
          configurable: true, get: () => state,
          set: (value: NonNullable<Window["__vn"]>) => {
            state = value;
            console.debug(`longform:state:${value.phase}:${value.sceneId}:${value.lineIndex}:${value.typing}`);
          },
        });
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          setItem.call(this, key, value);
          if (this === localStorage && key.startsWith("vnmaker:auto:")) console.debug("longform:autosaved");
        };
      });
      await page.goto(exported.origin);
      await expect(page.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
      await use(page);
      expect(errors).toEqual([]); expect(external).toEqual([]); expect(exported.missing).toEqual([]);
    },
  });

  test.describe("long-form exported novel", () => {
    test("preserves the complete source and all rich art", async ({ player, exported }, testInfo) => {
      // Given one real UI export; When its source and media are read; Then nothing is omitted.
      expect(source.scenes).toHaveLength(20);
      expect(source.scenes.reduce((count, scene) => count + scene.lines.length, 0)).toBe(829);
      expect(source.assets).toHaveLength(35);
      expect(routes).toHaveLength(8);
      expect(new Set(routes.map(route => route.ending)).size).toBe(2);
      expect([...new Set(routes.flatMap(route => route.scenes))].sort()).toEqual(source.scenes.map(scene => scene.id).sort());
      for (const asset of source.assets ?? []) expect((await stat(resolve(exported.directory, `.${asset.url}`))).size).toBeGreaterThan(0);
      await player.getByTestId("bg-image").evaluate(image => { if (image instanceof HTMLImageElement) return image.decode(); throw new Error("Expected title image"); });
      await player.screenshot({ path: testInfo.outputPath("longform-standalone-title.png") });
      await writeFile(testInfo.outputPath("all-route-report.json"), JSON.stringify(routes.map((route, index) => ({ route: index + 1, ...route })), null, 2));
    });

    test("restores two independent manual save slots", async ({ player }, testInfo) => {
      // Given two different played positions; When each slot is loaded; Then its dialogue is restored.
      const first = source.scenes.find(scene => scene.id === source.start);
      if (!first?.lines[0] || !first.lines[1]) throw new Error("Expected two opening lines");
      await clickTo(player, "start-button", `scene:${source.start}:0:false`);
      await expect(player.getByTestId("dialogue-text")).toHaveText(first.lines[0].text);
      await player.getByTestId("save-button").click(); await player.getByTestId("slot-save-0").click();
      await clickTo(player, "advance-button", `scene:${source.start}:1:false`);
      await player.getByTestId("save-button").click(); await player.getByTestId("slot-save-1").click();
      await player.getByTestId("load-button").click();
      await player.screenshot({ path: testInfo.outputPath("longform-standalone-slots.png") });
      await clickTo(player, "slot-load-0", `scene:${source.start}:0:false`);
      await expect(player.getByTestId("dialogue-text")).toHaveText(first.lines[0].text);
      await player.getByTestId("load-button").click();
      await clickTo(player, "slot-load-1", `scene:${source.start}:1:false`);
      await expect(player.getByTestId("dialogue-text")).toHaveText(first.lines[1].text);
    });

    test("pauses auto advance while viewing art and resumes afterward", async ({ player }, testInfo) => {
      // Given auto mode at a completed line; When art is open beyond its deadline; Then position is unchanged.
      const first = source.scenes.find(scene => scene.id === source.start);
      if (!first?.lines[1] || !first.lines[2]) throw new Error("Expected second and third opening lines");
      await clickTo(player, "start-button", `scene:${source.start}:0:false`);
      await clickTo(player, "advance-button", `scene:${source.start}:1:false`);
      const clockOrigin = new Date("2026-09-07T00:00:00.000Z");
      await player.clock.install({ time: clockOrigin });
      await player.clock.pauseAt(new Date(clockOrigin.getTime() + 600_000));
      await player.getByTestId("auto-button").click(); await player.getByTestId("art-view-button").click();
      await expect(player.getByTestId("dialogue-text")).toHaveCount(0); await expect(player.getByTestId("save-button")).toHaveCount(0);
      await player.clock.runFor(1000 + first.lines[1].text.length * 45);
      expect(await player.evaluate(() => window.__vn?.lineIndex)).toBe(1);
      await player.screenshot({ path: testInfo.outputPath("longform-standalone-art-view.png") });
      await player.getByTestId("art-view-button").click();
      const resumed = player.waitForEvent("console", { predicate: message => message.text().startsWith(`longform:state:scene:${source.start}:2:`), timeout: 15000 });
      await player.clock.runFor(700 + first.lines[1].text.length * 45); await resumed;
      expect(await player.evaluate(() => window.__vn?.lineIndex)).toBe(2);
      await player.getByTestId("auto-button").click();
      const typed = player.waitForEvent("console", { predicate: message => message.text() === `longform:state:scene:${source.start}:2:false`, timeout: 15000 });
      await Promise.all([typed, player.clock.resume()]);
      await expect(player.getByTestId("dialogue-text")).toHaveText(first.lines[2].text);
      await expect(player.getByTestId("dialogue-text")).toBeVisible();
    });

    const scenarios = routes.flatMap((route, index) => [
      ...(index === 0 ? [{ route, index, title: "plays the first-choice path through all 17 scenes", screenshot: "longform-standalone-ending.png" }] : []),
      { route, index, title: `route ${index + 1} (${route.choices.join("-")}) reaches its source ending, flags and history`, screenshot: `route-${index + 1}-ending.png` },
    ]);
    for (const { index, route, title, screenshot } of scenarios) {
      test(title, async ({ player }, testInfo) => {
        // Given an isolated player and a source-defined route; When its real controls are used; Then every scene and final state agree.
        await player.setViewportSize(index % 2 ? { width: 390, height: 844 } : { width: 1440, height: 900 });
        await clickTo(player, "start-button", `scene:${source.start}:0:false`);
        let decision = 0;
        const visited: string[] = [];
        for (const [position, id] of route.scenes.entries()) {
          const scene = source.scenes.find(row => row.id === id);
          if (!scene) throw new Error(`Missing source scene ${id}`);
          const state = await player.evaluate(() => window.__vn);
          expect(state?.sceneId).toBe(id); expect(state?.error).toBeNull();
          const firstLine = scene.lines.find(line => lineAllowed(line, state?.flags ?? {}));
          if (!firstLine) throw new Error(`No visible source line in ${id}`);
          await expect(player.getByTestId("dialogue-text")).toHaveText(firstLine.text);
          visited.push(id);
          if (routes.findIndex(candidate => candidate.scenes.includes(id)) === index) {
            await player.getByTestId("bg-image").evaluate(image => { if (image instanceof HTMLImageElement) return image.decode(); throw new Error("Expected scene image"); });
            await player.screenshot({ path: testInfo.outputPath(`route-scene-${id}.png`) });
          }
          if (scene.choices?.length) {
            await clickTo(player, "skip-button", `choice:${id}:${scene.lines.length - 1}:false`);
            await clickTo(player, `choice-${route.choices[decision++]}`, `scene:${route.scenes[position + 1]}:0:false`);
          } else if (scene.ending) await clickTo(player, "skip-button", `ending:${id}:${scene.lines.length - 1}:false`);
          else await clickTo(player, "skip-button", `scene:${route.scenes[position + 1]}:0:false`);
        }
        expect(visited).toEqual(route.scenes);
        if (index === 0) expect(visited).toHaveLength(17);
        await expect(player.getByTestId("ending-title")).toHaveText(route.ending);
        const final = await player.evaluate(() => window.__vn);
        expect(final?.flags).toEqual(route.flags); expect(final?.error).toBeNull();
        const historyCount = await player.evaluate(() => {
          const key = Object.keys(localStorage).find(key => key.startsWith("vnmaker:auto:"));
          const saved: unknown = JSON.parse(localStorage.getItem(key ?? "") ?? "null");
          if (typeof saved !== "object" || saved === null || !("history" in saved) || !Array.isArray(saved.history)) throw new Error("Missing ending autosave history");
          return saved.history.length;
        });
        expect(historyCount).toBe(route.historyCount);
        await player.screenshot({ path: testInfo.outputPath(screenshot) });
        await writeFile(testInfo.outputPath("route-report.json"), JSON.stringify({ route: index + 1, scenes: visited, ending: await player.getByTestId("ending-title").textContent(), flags: final?.flags, historyCount }, null, 2));
      });
    }
  });
}
