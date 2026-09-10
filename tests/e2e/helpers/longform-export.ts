import { test as base, expect, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { script, parseScript, applyChoiceFlags, choiceAllowed, lineAllowed, type StoryFlags, type VnScript } from "../../../packages/content/src/index.js";
import type {} from "../../../packages/app/src/App.js";

type Route = { readonly scenes: readonly string[]; readonly choices: readonly number[]; readonly flags: StoryFlags; readonly ending: string; readonly historyCount: number };
type Hosting = { readonly server: Server; readonly origin: string; readonly missing: string[] };
type LongformMatch = { readonly exact: string } | { readonly prefix: string };
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

declare global {
  interface Window {
    __longformWaiters?: Array<(text: string) => void>;
    __longformArmed?: Promise<void>;
    __longformStartDeadline?: () => void;
  }
}
const expectMs = 15_000;

// Each signal is subscribed before its user action. The accessor observes the existing
// diagnostic publication without changing the reducer, timers or persistence behavior.
async function observeLongformPlayer(page: Page) {
  await page.addInitScript(() => {
    const waiters: NonNullable<Window["__longformWaiters"]> = [];
    window.__longformWaiters = waiters;
    let state: Window["__vn"];
    function publish(text: string) {
      console.debug(text);
      for (const waiter of waiters.slice()) waiter(text);
    }
    Object.defineProperty(window, "__vn", {
      configurable: true, get: () => state,
      set: (value: NonNullable<Window["__vn"]>) => {
        state = value;
        publish(`longform:state:${value.phase}:${value.sceneId}:${value.lineIndex}:${value.typing}`);
      },
    });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      setItem.call(this, key, value);
      if (this === localStorage && key.startsWith("vnmaker:auto:")) publish("longform:autosaved");
    };
  });
}
async function armLongform(page: Page, match: LongformMatch | readonly LongformMatch[]) {
  const matches = (Array.isArray(match) ? match : [match]).map(item => "exact" in item ? { exact: item.exact } : { prefix: item.prefix });
  await page.evaluate(({ matches, ms }) => {
    const waiters = window.__longformWaiters;
    if (!waiters) throw new Error("longform observer was not installed");
    window.__longformArmed = new Promise<void>((resolve, reject) => {
      let timeout: number | undefined;
      let deadlineStarted = false;
      let settled = false;
      const pending = new Set(matches.map((_, index) => index));
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        const waiterIndex = waiters.indexOf(check);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        if (error) reject(error);
        else resolve();
      };
      function check(text: string) {
        matches.forEach((item, index) => {
          if (!pending.has(index)) return;
          const hit = typeof item.exact === "string" ? text === item.exact : typeof item.prefix === "string" && text.startsWith(item.prefix);
          if (hit) pending.delete(index);
        });
        if (pending.size === 0) finish();
      }
      window.__longformStartDeadline = () => {
        if (settled || deadlineStarted) return;
        deadlineStarted = true;
        timeout = window.setTimeout(() => finish(new Error("Timeout 15000ms exceeded while waiting for event \"console\"")), ms);
      };
      waiters.push(check);
    });
  }, { matches, ms: expectMs });
}
async function awaitLongform(page: Page) {
  await page.evaluate(() => {
    const armed = window.__longformArmed;
    if (!armed) throw new Error("longform observer was not armed");
    window.__longformStartDeadline?.();
    return armed;
  });
}
async function clickTo(page: Page, button: string, state: string) {
  await armLongform(page, [{ exact: `longform:state:${state}` }, { exact: "longform:autosaved" }]);
  await page.getByTestId(button).click();
  await awaitLongform(page);
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
      });
      await observeLongformPlayer(page);
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
      await armLongform(player, { prefix: `longform:state:scene:${source.start}:2:` });
      await player.clock.runFor(700 + first.lines[1].text.length * 45);
      await awaitLongform(player);
      expect(await player.evaluate(() => window.__vn?.lineIndex)).toBe(2);
      await player.getByTestId("auto-button").click();
      await armLongform(player, { exact: `longform:state:scene:${source.start}:2:false` });
      await player.clock.resume();
      await awaitLongform(player);
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

  test("longform observer does not succeed without a published state", async ({ page }) => {
    test.setTimeout(30_000);
    const clockStart = new Date("2026-09-07T00:00:00Z");
    await page.clock.install({ time: clockStart });
    await observeLongformPlayer(page);
    await page.goto("about:blank");
    await page.clock.pauseAt(new Date("2026-09-07T00:00:01Z"));
    await armLongform(page, [{ exact: "longform:state:scene:s06a:0:false" }, { exact: "longform:autosaved" }]);
    const outcome = page.evaluate(() => {
      if (!window.__longformArmed) throw new Error("longform observer was not armed");
      return window.__longformArmed;
    }).then(() => ({ status: "published" as const }), (error: unknown) => ({ status: "rejected" as const, error }));
    await page.mouse.click(1, 1);
    await page.evaluate(() => {
      window.__vn = {
        sceneId: "s06a",
        lineIndex: 0,
        affection: 0,
        typing: true,
        phase: "scene",
        error: null,
        lastDiff: null,
        flags: {},
      };
      for (const waiter of window.__longformWaiters ?? []) waiter("longform:autosaved");
    });
    const swallowing = awaitLongform(page).then(() => undefined, () => undefined);
    await page.clock.runFor(expectMs);
    await swallowing;
    const result = await outcome;
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("observer succeeded without a published s06a typing-false state");
    expect(String(result.error)).toMatch(/Timeout 15000ms/);
  });

  test("longform observer does not start the publication deadline before dispatch", async ({ page }) => {
    test.setTimeout(30_000);
    const deadlineSentinel = "__longform_deadline_registered";
    const clockStart = new Date("2026-09-07T00:00:00Z");
    await page.clock.install({ time: clockStart });
    await observeLongformPlayer(page);
    await page.goto("about:blank");
    await page.clock.pauseAt(new Date("2026-09-07T00:00:01Z"));
    await page.evaluate(({ ms, deadlineSentinel }) => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = function (handler: TimerHandler, delay?: number, ...rest: unknown[]) {
        const id = original(handler, delay, ...rest);
        if (delay === ms) console.log(deadlineSentinel);
        return id;
      } as typeof window.setTimeout;
    }, { ms: expectMs, deadlineSentinel });
    const deadlineLogs: string[] = [];
    page.on("console", message => {
      if (message.text() === deadlineSentinel) deadlineLogs.push(message.text());
    });
    await armLongform(page, [{ exact: "longform:state:scene:s06a:0:false" }, { exact: "longform:autosaved" }]);
    expect(deadlineLogs).toEqual([]);
    const peek = () => page.evaluate(async () => {
      const armed = window.__longformArmed;
      if (!armed) throw new Error("no armed waiter");
      let state: "pending" | "resolved" | "rejected" = "pending";
      void armed.then(() => { state = "resolved"; }, () => { state = "rejected"; });
      await Promise.resolve();
      return state;
    });
    await page.clock.runFor(expectMs);
    expect(await peek()).toBe("pending");
    const deadlineRegistered = page.waitForEvent("console", {
      timeout: expectMs,
      predicate: message => message.text() === deadlineSentinel,
    });
    const outcome = awaitLongform(page).then(
      () => "resolved" as const,
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    await deadlineRegistered;
    expect(await peek()).toBe("pending");
    await page.evaluate(() => {
      window.__vn = {
        sceneId: "s06a",
        lineIndex: 0,
        affection: 0,
        typing: false,
        phase: "scene",
        error: null,
        lastDiff: null,
        flags: {},
      };
      for (const waiter of window.__longformWaiters ?? []) waiter("longform:autosaved");
    });
    expect(await outcome).toBe("resolved");
    expect(await peek()).toBe("resolved");
  });
}
