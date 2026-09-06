import {test,expect} from "@playwright/test";

test("volume changes do not restart music fades or replay the current dialogue effect",async({page},info)=>{
  test.setTimeout(30000);
  await page.addInitScript(()=>{
    const original=HTMLMediaElement.prototype.play;
    (window as unknown as {audioStarts:string[]}).audioStarts=[];
    HTMLMediaElement.prototype.play=function(){(window as unknown as {audioStarts:string[]}).audioStarts.push(this.currentSrc||this.src);return original.call(this);};
    sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"음량 회귀",subtitle:"",start:"s",characters:[],scenes:[{id:"s",background:"title",bgm:"daily",lines:[{speaker:null,text:"음량을 바꿔도 이 효과음은 다시 울리지 않아야 합니다.",sfx:"page-turn"},{speaker:null,text:"다음 효과음은 새 음량을 사용합니다.",sfx:"page-turn",bgm:"rain"}],ending:"끝"}]}));
    sessionStorage.setItem("vnmaker.previewPosition",JSON.stringify({sceneId:"s",lineIndex:0,flags:{}}));
  });
  await page.goto("/?preview=1");
  await page.getByTestId("settings-button").click();
  const music=page.getByTestId("bgm-audio");
  await expect.poll(()=>music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBeGreaterThan(.3);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {audioStarts:string[]}).audioStarts.filter(src=>src.includes("page-turn")).length)).toBe(1);
  // Wait for the initial fade to finish using the configured target, not elapsed test time.
  const target=await page.getByTestId("bgm-volume").inputValue();await expect.poll(()=>music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(Number(target));
  const starts=await page.evaluate(()=>(window as unknown as {audioStarts:string[]}).audioStarts.length);
  const before=await music.evaluate((audio:HTMLAudioElement)=>audio.currentTime);
  await page.getByTestId("bgm-volume").fill("0.25");
  // A fresh 1.2-second ramp cannot satisfy this immediate volume check.
  expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(.25);
  await page.getByTestId("bgm-volume").fill("0");expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(0);
  await page.getByTestId("bgm-volume").fill("0.8");expect(await music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(.8);
  await page.getByTestId("sfx-volume").fill("0.2");
  expect(await page.evaluate(()=>(window as unknown as {audioStarts:string[]}).audioStarts.length)).toBe(starts);
  expect(await music.evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThanOrEqual(before);
  await page.screenshot({path:info.outputPath("audio-settings.png")});
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__vn?.typing)).toBe(false);await page.getByTestId("advance-button").click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {audioStarts:string[]}).audioStarts.filter(src=>src.includes("page-turn")).length)).toBe(2);
  await page.getByTestId("settings-button").click();
  expect(await page.getByTestId("bgm-audio-idle").evaluate((audio:HTMLAudioElement)=>audio.paused)).toBe(false);
  await page.getByTestId("bgm-volume").fill("0");
  expect(await page.locator("audio[data-testid^=bgm-audio]").evaluateAll((nodes:HTMLAudioElement[])=>nodes.map(node=>node.volume))).toEqual([0,0]);
  await page.getByTestId("bgm-volume").fill("0.5");
  await expect.poll(()=>music.evaluate((audio:HTMLAudioElement)=>audio.volume)).toBe(.5);
  expect(await page.getByTestId("bgm-audio-idle").evaluate((audio:HTMLAudioElement)=>audio.paused)).toBe(true);
});
