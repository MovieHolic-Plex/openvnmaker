import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

const expectMs = 15_000;

type SlotProbe = {volume: number; paused: boolean; playing: boolean; src: string};
type BgmArm =
  | {readonly check: "ready"; readonly target: number}
  | {readonly check: "stop"; readonly target: number; readonly duration: number};

declare global {
  interface Window {
    __bgmProbe?: {
      active: SlotProbe;
      idle: SlotProbe;
      initError: string | null;
    };
    __bgmWaiters?: Array<() => void>;
    __bgmArmed?: Promise<void>;
    __bgmStartDeadline?: () => void;
    __dialogueArmed?: Promise<void>;
  }
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); });
  return errors;
}

async function installPreview(page: Page, duration: number): Promise<void> {
  await page.addInitScript(duration => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({title: "음악 페이드", subtitle: "", start: "s", musicFadeSeconds: duration, characters: [], scenes: [{id: "s", background: "title", bgm: "daily", lines: [{speaker: null, text: "시작"}, {speaker: null, text: "정지", bgm: null}], ending: "끝"}]}));
    sessionStorage.setItem("vnmaker.previewPosition", JSON.stringify({sceneId: "s", lineIndex: 0, flags: {}}));
    const slot = (): SlotProbe => ({volume: 0, paused: true, playing: false, src: ""});
    const probe: {active: SlotProbe; idle: SlotProbe; initError: string | null} = {active: slot(), idle: slot(), initError: null};
    const waiters: Array<() => void> = [];
    window.__bgmProbe = probe;
    window.__bgmWaiters = waiters;
    const playedSrc = new WeakMap<HTMLAudioElement, string>();
    const notify = () => { for (const waiter of waiters) waiter(); };
    const pull = (el: HTMLAudioElement) => {
      const id = el.getAttribute("data-testid");
      const current = id === "bgm-audio" ? probe.active : id === "bgm-audio-idle" ? probe.idle : undefined;
      if (!current) return;
      const src = el.currentSrc || el.src;
      current.volume = el.volume;
      current.paused = el.paused;
      current.src = src;
      current.playing = !el.paused && src.length > 0 && playedSrc.get(el) === src;
      notify();
    };
    const fromEvent = (event: Event) => {
      if (!(event.target instanceof HTMLAudioElement)) return;
      const el = event.target;
      const src = el.currentSrc || el.src;
      if (event.type === "playing" && src.length > 0) playedSrc.set(el, src);
      if (event.type === "pause") playedSrc.delete(el);
      pull(el);
    };
    document.addEventListener("volumechange", fromEvent, true);
    document.addEventListener("playing", fromEvent, true);
    document.addEventListener("pause", fromEvent, true);
    const scan = () => {
      for (const node of document.querySelectorAll("audio[data-testid^=bgm-audio]")) {
        if (node instanceof HTMLAudioElement) pull(node);
      }
    };
    try {
      new MutationObserver(scan).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ["data-testid", "src"]});
    } catch (error) {
      probe.initError = error instanceof Error ? error.message : "observer failed";
      throw error;
    }
    scan();
  }, duration);
}

async function armBgm(page: Page, spec: BgmArm): Promise<void> {
  await page.evaluate(({spec, expectMs}) => {
    const probe = window.__bgmProbe;
    const waiters = window.__bgmWaiters;
    if (!probe || !waiters) throw new Error("bgm probe was not installed");
    if (probe.initError) throw new Error(probe.initError);
    window.__bgmArmed = new Promise<void>((resolve, reject) => {
      let timeout: number | undefined;
      let deadlineStarted = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        reject(new Error(`bgm ${spec.check} wait`));
      };
      window.__bgmStartDeadline = () => {
        if (settled || deadlineStarted) return;
        deadlineStarted = true;
        timeout = window.setTimeout(fail, expectMs);
      };
      let phase = spec.check === "stop" && spec.duration > 0 ? 0 : 2;
      const check = () => {
        if (spec.check === "ready") {
          const active = probe.active;
          if (active.playing && !active.paused && active.volume === spec.target) finish();
          return;
        }
        const {active, idle} = probe;
        if (phase === 0) {
          if (idle.playing && idle.volume > 0) phase = 1;
          else return;
        }
        if (phase === 1) {
          if (idle.volume < spec.target * 0.75) phase = 2;
          else return;
        }
        if (active.paused && active.volume === 0 && idle.paused && idle.volume === 0) finish();
      };
      waiters.push(check);
      check();
    });
  }, {spec, expectMs});
}

async function settleBgm(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__bgmStartDeadline?.();
    return window.__bgmArmed;
  });
}

async function armDialogue(page: Page, text: string): Promise<void> {
  await page.evaluate(({text, expectMs}) => {
    window.__dialogueArmed = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`dialogue ${text}`)), expectMs);
      const el = document.querySelector('[data-testid="dialogue-text"]');
      if (!(el instanceof HTMLElement)) {
        window.clearTimeout(timeout);
        reject(new Error("no dialogue-text"));
        return;
      }
      const check = () => {
        if (el.textContent === text) {
          window.clearTimeout(timeout);
          resolve();
        }
      };
      new MutationObserver(check).observe(el, {characterData: true, subtree: true, childList: true});
      check();
    });
  }, {text, expectMs});
}

for (const duration of [0, 1.5]) test(`music stop uses authored ${duration} second fade`, async ({page}) => {
  test.setTimeout(30000);
  const errors = collectPageErrors(page);
  await installPreview(page, duration);
  await page.goto("/?preview=1");
  await armBgm(page, {check: "ready", target: 0.55});
  await page.getByTestId("settings-button").click();
  const target = Number(await page.getByTestId("bgm-volume").inputValue());
  expect(target).toBe(0.55);
  await settleBgm(page);
  await page.getByRole("button", {name: "닫기", exact: true}).click();
  await armDialogue(page, "시작");
  await page.evaluate(() => window.__dialogueArmed);
  await armBgm(page, {check: "stop", target, duration});
  await armDialogue(page, "정지");
  await page.getByTestId("advance-button").click();
  await page.evaluate(() => window.__dialogueArmed);
  await settleBgm(page);
  expect(errors).toEqual([]);
});

test("music fade readiness does not treat a pending play as playing", async ({page}) => {
  test.setTimeout(30000);
  let release = (): void => { return; };
  let released = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/assets/audio/bgm/daily.mp3", async route => {
    await held;
    await route.continue();
  });
  const errors = collectPageErrors(page);
  await installPreview(page, 1.5);
  await page.goto("/?preview=1");
  await armBgm(page, {check: "ready", target: 0.55});
  await page.getByTestId("settings-button").click();
  try {
    await page.evaluate(({expectMs}) => new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("bgm src never assigned")), expectMs);
      const waiters = window.__bgmWaiters;
      if (!waiters) {
        window.clearTimeout(timeout);
        reject(new Error("missing waiters"));
        return;
      }
      const check = () => {
        if (!(window.__bgmProbe?.active.src.includes("daily.mp3"))) return;
        window.clearTimeout(timeout);
        resolve();
      };
      waiters.push(check);
      check();
    }), {expectMs});
    const pending = await page.evaluate(async () => {
      let readySettled = false;
      void window.__bgmArmed?.then(() => { readySettled = true; });
      await Promise.resolve();
      const el = document.querySelector('[data-testid="bgm-audio"]');
      return {
        probePlaying: window.__bgmProbe?.active.playing ?? false,
        readySettled,
        readyState: el instanceof HTMLAudioElement ? el.readyState : -1,
        initError: window.__bgmProbe?.initError ?? null,
      };
    });
    expect(pending.initError).toBeNull();
    expect(pending.readyState).toBeLessThan(2);
    expect(pending.probePlaying).toBe(false);
    expect(pending.readySettled).toBe(false);
    release();
    released = true;
    await settleBgm(page);
    expect(await page.evaluate(() => window.__bgmProbe?.active.playing ?? false)).toBe(true);
    expect(await page.evaluate(() => window.__bgmProbe?.active.volume ?? Number.NaN)).toBe(0.55);
    expect(errors).toEqual([]);
  } finally {
    if (!released) release();
  }
});

test("armed bgm waiter does not start the 15s bound until settle", async ({page}) => {
  test.setTimeout(30000);
  const deadlineSentinel = "__bgm_deadline_registered";
  const clockStart = new Date("2026-09-07T00:00:00Z");
  await page.clock.install({time: clockStart});
  await page.addInitScript(() => {
    const slot = () => ({volume: 0, paused: true, playing: false, src: ""});
    window.__bgmProbe = {active: slot(), idle: slot(), initError: null};
    window.__bgmWaiters = [];
  });
  await page.goto("about:blank");
  await page.clock.pauseAt(new Date("2026-09-07T00:00:01Z"));
  await page.evaluate(({ms, deadlineSentinel}) => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = function(handler: TimerHandler, delay?: number, ...rest: unknown[]) {
      const id = original(handler, delay, ...rest);
      if (delay === ms) console.log(deadlineSentinel);
      return id;
    } as typeof window.setTimeout;
  }, {ms: expectMs, deadlineSentinel});
  await armBgm(page, {check: "ready", target: 0.55});
  const peek = () => page.evaluate(async () => {
    const armed = window.__bgmArmed;
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
  const outcome = settleBgm(page).then(
    () => "resolved",
    (error: unknown) => error instanceof Error ? error.message : String(error),
  );
  await deadlineRegistered;
  await page.clock.runFor(expectMs - 1);
  expect(await peek()).toBe("pending");
  await page.clock.runFor(1);
  expect(await peek()).toBe("rejected");
  expect(await outcome).toMatch(/bgm ready wait/);
});
