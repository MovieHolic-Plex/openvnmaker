import {test,expect} from "@playwright/test";

for(const duration of [0,1.5])test(`music stop uses authored ${duration} second fade`,async({page})=>{
  test.setTimeout(30000);
  await page.addInitScript(duration=>{
    sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"음악 페이드",subtitle:"",start:"s",musicFadeSeconds:duration,characters:[],scenes:[{id:"s",background:"title",bgm:"daily",lines:[{speaker:null,text:"시작"},{speaker:null,text:"정지",bgm:null}],ending:"끝"}]}));sessionStorage.setItem("vnmaker.previewPosition",JSON.stringify({sceneId:"s",lineIndex:0,flags:{}}));
  },duration);
  await page.goto("/?preview=1");await page.getByTestId("settings-button").click();
  const target=Number(await page.getByTestId("bgm-volume").inputValue());await expect.poll(()=>page.getByTestId("bgm-audio").evaluate((el:HTMLAudioElement)=>el.volume)).toBe(target);
  await page.getByRole("button",{name:"닫기",exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__vn?.typing)).toBe(false);
  await page.getByTestId("advance-button").click();await expect(page.getByTestId("dialogue-text")).toHaveText("정지");
  const idle=page.getByTestId("bgm-audio-idle");
  if(duration){expect(await idle.evaluate((el:HTMLAudioElement)=>!el.paused&&el.volume>0)).toBe(true);await expect.poll(()=>idle.evaluate((el:HTMLAudioElement)=>el.volume)).toBeLessThan(target*.75);}
  await expect.poll(()=>page.locator("audio[data-testid^=bgm-audio]").evaluateAll((els:HTMLAudioElement[])=>els.every(el=>el.paused&&el.volume===0))).toBe(true);
});
