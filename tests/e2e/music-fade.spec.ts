import {test,expect} from "@playwright/test";
import {vnState} from "./helpers.js";

declare global {
  interface Window {
    __bgmProbe?: {
      active: {volume: number; paused: boolean; playing: boolean};
      idle: {volume: number; paused: boolean; playing: boolean};
    };
  }
}

for (const duration of [0, 1.5]) test(`music stop uses authored ${duration} second fade`, async ({page}) => {
  test.setTimeout(30000);
  await page.addInitScript(duration => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({title: "음악 페이드", subtitle: "", start: "s", musicFadeSeconds: duration, characters: [], scenes: [{id: "s", background: "title", bgm: "daily", lines: [{speaker: null, text: "시작"}, {speaker: null, text: "정지", bgm: null}], ending: "끝"}]}));
    sessionStorage.setItem("vnmaker.previewPosition", JSON.stringify({sceneId: "s", lineIndex: 0, flags: {}}));
    const slot = () => ({volume: 0, paused: true, playing: false});
    const probe = {active: slot(), idle: slot()};
    window.__bgmProbe = probe;
    const pull = (el: HTMLAudioElement) => {
      const id = el.getAttribute("data-testid");
      const current = id === "bgm-audio" ? probe.active : id === "bgm-audio-idle" ? probe.idle : undefined;
      if (!current) return;
      current.volume = el.volume;
      current.paused = el.paused;
      if (!el.paused) current.playing = true;
    };
    const fromEvent = (event: Event) => {
      if (event.target instanceof HTMLAudioElement) pull(event.target);
    };
    document.addEventListener("volumechange", fromEvent, true);
    document.addEventListener("playing", fromEvent, true);
    document.addEventListener("pause", fromEvent, true);
    const scan = () => {
      for (const node of document.querySelectorAll("audio[data-testid^=bgm-audio]")) {
        if (node instanceof HTMLAudioElement) pull(node);
      }
    };
    new MutationObserver(scan).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ["data-testid", "src"]});
    scan();
  }, duration);
  await page.goto("/?preview=1");
  await page.getByTestId("settings-button").click();
  const target = Number(await page.getByTestId("bgm-volume").inputValue());
  await expect.poll(() => page.evaluate(() => window.__bgmProbe?.active ?? {volume: Number.NaN, paused: true, playing: false})).toEqual({volume: target, paused: false, playing: true});
  await page.getByRole("button", {name: "닫기", exact: true}).click();
  await expect.poll(() => vnState(page).then(state => state.typing)).toBe(false);
  await page.getByTestId("advance-button").click();
  await expect(page.getByTestId("dialogue-text")).toHaveText("정지");
  const idle = page.getByTestId("bgm-audio-idle");
  if (duration) {
    expect(await idle.evaluate((el: HTMLAudioElement) => !el.paused && el.volume > 0)).toBe(true);
    await expect.poll(() => idle.evaluate((el: HTMLAudioElement) => el.volume)).toBeLessThan(target * .75);
  }
  await expect.poll(() => page.locator("audio[data-testid^=bgm-audio]").evaluateAll((els: HTMLAudioElement[]) => els.every(el => el.paused && el.volume === 0))).toBe(true);
});
