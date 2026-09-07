import {test,expect} from "@playwright/test";
import type {Page} from "@playwright/test";

const fadeMs=1200;
const midFadeMs=200;
const readyVolume=0.55;
const clockStart=new Date("2026-09-07T00:00:00Z");
const clockPaused=new Date("2026-09-07T00:10:00Z");

type MediaArm =
  | {readonly kind: "ready"; readonly volume: number; readonly pageTurns: number}
  | {readonly kind: "crossfade"}
  | {readonly kind: "rain-src"};

type BgmSlot = {
  readonly paused: boolean;
  readonly playing: boolean;
  readonly volume: number;
  readonly src: string;
  readonly readyState: number;
};

declare global {
  interface Window {
    audioStarts: string[];
    __audioMedia?: {
      readonly played: WeakMap<HTMLAudioElement, string>;
      readonly waiters: Array<() => void>;
      armed?: Promise<void>;
      srcArmed?: Promise<void>;
    };
  }
}

async function installPreview(page: Page): Promise<void> {
  await page.addInitScript(()=>{
    const original=HTMLMediaElement.prototype.play;
    window.audioStarts=[];
    const played=new WeakMap<HTMLAudioElement, string>();
    const waiters: Array<() => void>=[];
    window.__audioMedia={played, waiters};
    HTMLMediaElement.prototype.play=function(){
      window.audioStarts.push(this.currentSrc||this.src);
      const result=original.call(this);
      for (const waiter of waiters) waiter();
      return result;
    };
    const notify=()=>{for (const waiter of waiters) waiter();};
    const fromEvent=(event: Event)=>{
      if (!(event.target instanceof HTMLAudioElement)) return;
      const el=event.target;
      const src=el.currentSrc||el.src;
      if (event.type==="playing" && src.length>0) played.set(el, src);
      if (event.type==="pause") played.delete(el);
      notify();
    };
    document.addEventListener("playing", fromEvent, true);
    document.addEventListener("pause", fromEvent, true);
    document.addEventListener("volumechange", fromEvent, true);
    new MutationObserver(notify).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ["data-testid", "src"]});
    sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"음량 회귀",subtitle:"",start:"s",musicFadeSeconds:1.2,characters:[],scenes:[{id:"s",background:"title",bgm:"daily",lines:[{speaker:null,text:"음량을 바꿔도 이 효과음은 다시 울리지 않아야 합니다.",sfx:"page-turn"},{speaker:null,text:"다음 효과음은 새 음량을 사용합니다.",sfx:"page-turn",bgm:"rain"}],ending:"끝"}]}));
    sessionStorage.setItem("vnmaker.previewPosition",JSON.stringify({sceneId:"s",lineIndex:0,flags:{}}));
  });
}

async function arm(page: Page, spec: MediaArm): Promise<void> {
  await page.evaluate((spec)=>{
    const media=window.__audioMedia;
    if (!media) throw new Error("audio media probe missing");
    const srcOf=(el: Element | null)=>{
      return el instanceof HTMLAudioElement ? (el.currentSrc||el.src) : "";
    };
    const playing=(el: Element | null)=>{
      if (!(el instanceof HTMLAudioElement)) return false;
      const src=srcOf(el);
      return !el.paused && src.length>0 && media.played.get(el)===src;
    };
    media.armed=new Promise<void>((resolve)=>{
      const check=()=>{
        const active=document.querySelector('[data-testid="bgm-audio"]');
        const idle=document.querySelector('[data-testid="bgm-audio-idle"]');
        const pageTurns=window.audioStarts.filter(src=>src.includes("page-turn")).length;
        switch (spec.kind) {
          case "ready":
            if (playing(active) && srcOf(active).includes("daily") && active instanceof HTMLAudioElement && active.volume===spec.volume && pageTurns===spec.pageTurns) resolve();
            return;
          case "crossfade":
            if (playing(active) && playing(idle) && srcOf(active).includes("rain") && srcOf(idle).includes("daily")) resolve();
            return;
          case "rain-src":
            if (srcOf(active).includes("rain")) resolve();
            return;
          default: {
            const unreachable: never=spec;
            throw new Error(`unknown arm ${String(unreachable)}`);
          }
        }
      };
      media.waiters.push(check);
      check();
    });
  }, spec);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(()=>{
    const armed=window.__audioMedia?.armed;
    if (!armed) throw new Error("no armed waiter");
    return armed;
  });
}

async function readBgm(page: Page): Promise<{readonly active: BgmSlot; readonly idle: BgmSlot; readonly pageTurns: number; readonly starts: number}> {
  return page.evaluate(()=>{
    const media=window.__audioMedia;
    if (!media) throw new Error("audio media probe missing");
    const slot=(id: string): BgmSlot=>{
      const el=document.querySelector(`[data-testid="${id}"]`);
      if (!(el instanceof HTMLAudioElement)) return {paused: true, playing: false, volume: 0, src: "", readyState: -1};
      const src=el.currentSrc||el.src;
      return {
        paused: el.paused,
        playing: !el.paused && src.length>0 && media.played.get(el)===src,
        volume: el.volume,
        src,
        readyState: el.readyState,
      };
    };
    return {
      active: slot("bgm-audio"),
      idle: slot("bgm-audio-idle"),
      pageTurns: window.audioStarts.filter(src=>src.includes("page-turn")).length,
      starts: window.audioStarts.length,
    };
  });
}

test("volume changes do not restart music fades or replay the current dialogue effect",async({page},info)=>{
  test.setTimeout(30000);
  await page.clock.install({time:clockStart});
  await installPreview(page);
  await page.goto("/?preview=1");
  await arm(page, {kind: "ready", volume: readyVolume, pageTurns: 1});
  await page.getByTestId("settings-button").click();
  await settle(page);
  const music=page.getByTestId("bgm-audio");
  const target=await page.getByTestId("bgm-volume").inputValue();
  expect(Number(target)).toBe(readyVolume);
  expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(readyVolume);
  const starts=await page.evaluate(()=>window.audioStarts.length);
  const before=await music.evaluate((audio:HTMLAudioElement)=>audio.currentTime);
  await page.getByTestId("bgm-volume").fill("0.25");
  // A fresh 1.2-second ramp cannot satisfy this immediate volume check.
  expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(.25);
  await page.getByTestId("bgm-volume").fill("0");expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(0);
  await page.getByTestId("bgm-volume").fill("0.8");expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(.8);
  await page.getByTestId("sfx-volume").fill("0.2");
  expect(await page.evaluate(()=>window.audioStarts.length)).toBe(starts);
  expect(await music.evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThanOrEqual(before);
  await page.screenshot({path:info.outputPath("audio-settings.png")});
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page.locator(".next-mark")).toBeAttached();
  await page.clock.pauseAt(clockPaused);
  await arm(page, {kind: "crossfade"});
  await page.getByTestId("advance-button").click();
  await settle(page);
  await page.clock.fastForward(midFadeMs);
  await page.getByTestId("settings-button").click();
  const mid=await readBgm(page);
  expect(mid.active.playing).toBe(true);
  expect(mid.idle.playing).toBe(true);
  expect(mid.idle.paused).toBe(false);
  expect(mid.active.volume).toBeGreaterThan(0);
  expect(mid.idle.volume).toBeGreaterThan(0);
  await page.getByTestId("bgm-volume").fill("0");
  expect(await page.locator("audio[data-testid^=bgm-audio]").evaluateAll((nodes:HTMLAudioElement[])=>nodes.map(node=>node.volume))).toEqual([0,0]);
  await page.getByTestId("bgm-volume").fill("0.5");
  await page.clock.fastForward(fadeMs-midFadeMs);
  expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(.5);
  expect(await page.getByTestId("bgm-audio-idle").evaluate((audio:HTMLAudioElement)=>audio.paused)).toBe(true);
});

test("crossfade readiness does not treat a pending play as playing",async({page})=>{
  test.setTimeout(30000);
  let release=(): void=>{return;};
  let released=false;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/assets/audio/bgm/rain.mp3",async route=>{
    await held;
    await route.continue();
  });
  await installPreview(page);
  await page.goto("/?preview=1");
  await arm(page, {kind: "ready", volume: readyVolume, pageTurns: 1});
  await page.getByTestId("settings-button").click();
  await settle(page);
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page.locator(".next-mark")).toBeAttached();
  await arm(page, {kind: "crossfade"});
  await page.evaluate(()=>{
    const media=window.__audioMedia;
    if (!media) throw new Error("audio media probe missing");
    media.srcArmed=new Promise<void>((resolve)=>{
      const check=()=>{
        const el=document.querySelector('[data-testid="bgm-audio"]');
        const src=el instanceof HTMLAudioElement ? (el.currentSrc||el.src) : "";
        if (src.includes("rain")) resolve();
      };
      media.waiters.push(check);
      check();
    });
  });
  try {
    await page.getByTestId("advance-button").click();
    await page.evaluate(()=>{
      const armed=window.__audioMedia?.srcArmed;
      if (!armed) throw new Error("no src waiter");
      return armed;
    });
    const pending=await page.evaluate(async ()=>{
      let readySettled=false;
      void window.__audioMedia?.armed?.then(()=>{readySettled=true;});
      await Promise.resolve();
      return readySettled;
    });
    const heldSnap=await readBgm(page);
    expect(heldSnap.active.src.includes("rain")).toBe(true);
    expect(heldSnap.active.paused).toBe(false);
    expect(heldSnap.active.readyState).toBeLessThan(2);
    expect(heldSnap.active.playing).toBe(false);
    expect(pending).toBe(false);
    release();
    released=true;
    await settle(page);
    const live=await readBgm(page);
    expect(live.active.playing).toBe(true);
    expect(live.idle.playing).toBe(true);
  } finally {
    if (!released) release();
  }
});
