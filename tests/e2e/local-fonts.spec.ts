import {test, expect, type Page} from "@playwright/test";
import {writeFile} from "node:fs/promises";

const google=/fonts\.googleapis\.com|fonts\.gstatic\.com/;
const weights=(faces:{family:string;weight:string;status:string}[],family:string)=>faces.filter(face=>face.family===family).map(face=>face.weight).sort();

async function reportFonts(page:Page){
  return page.evaluate(async()=>{
    const sample="한글 기록 ABC";
    const needed=[
      ["400","IBM Plex Sans KR"],
      ["500","IBM Plex Sans KR"],
      ["600","IBM Plex Sans KR"],
      ["700","IBM Plex Sans KR"],
      ["600","Noto Serif KR"],
      ["700","Noto Serif KR"],
    ] as const;
    await Promise.all(needed.map(([weight,family])=>document.fonts.load(`${weight} 48px "${family}"`,sample)));
    await document.fonts.ready;
    const width=(font:string)=>{const ctx=document.createElement("canvas").getContext("2d");if(!ctx)throw new Error("canvas");ctx.font=font;return ctx.measureText(sample).width;};
    return{
      faces:[...document.fonts].map(face=>({family:face.family.replaceAll('"',""),weight:String(face.weight),status:face.status})),
      plex:width('400 48px "IBM Plex Sans KR"'),
      malgun:width('400 48px "Malgun Gothic"'),
      noto:width('700 48px "Noto Serif KR"'),
      batang:width('700 48px Batang'),
      prose:getComputedStyle(document.body).fontFamily,
    };
  });
}

function watch(page:Page){
  const requests:string[]=[];
  const fonts:{url:string;status:number;type:string}[]=[];
  page.on("request",request=>{requests.push(request.url());});
  page.on("response",response=>{
    if(response.url().endsWith(".woff2"))fonts.push({url:response.url(),status:response.status(),type:response.headers()["content-type"]??""});
  });
  return {requests,fonts};
}

test("player history stays readable on local Korean webfonts when Google Font hosts are blocked",async({page},info)=>{
  test.setTimeout(30000);
  const traffic=watch(page);
  await page.route(google,route=>route.abort());
  await page.addInitScript(()=>sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"긴 대사록",subtitle:"",start:"s",characters:[{id:"actor",name:"이서하",bio:"",color:"#b5d5ff"}],scenes:[{id:"s",chapter:"첫 번째 장",background:"title",lines:Array.from({length:60},(_,i)=>({speaker:i%2?"actor":null,text:`기록 ${i+1}: 그날의 대화를 기억한다.`})),next:"end"},{id:"end",chapter:"마지막 장",background:"title",lines:[{speaker:null,text:"읽던 자리"}],ending:"끝"}]})));
  await page.goto("/?preview=1");
  const report=await reportFonts(page);
  expect(traffic.requests.filter(url=>google.test(url))).toEqual([]);
  expect(weights(report.faces,"IBM Plex Sans KR")).toEqual(["400","500","600","700"]);
  expect(weights(report.faces,"Noto Serif KR")).toEqual(["600","700"]);
  expect(report.faces.filter(face=>face.family==="IBM Plex Sans KR"||face.family==="Noto Serif KR").every(face=>face.status==="loaded")).toBe(true);
  expect(report.plex).not.toBe(report.malgun);
  expect(report.noto).not.toBe(report.batang);
  expect(report.prose).toContain("IBM Plex Sans KR");
  expect(traffic.fonts.length).toBeGreaterThan(0);
  expect(traffic.fonts.every(font=>font.status===200&&font.type.includes("font/woff2")&&!google.test(font.url))).toBe(true);
  await page.getByTestId("skip-button").focus();await page.keyboard.press("Enter");await expect(page.getByTestId("dialogue-text")).toHaveText("읽던 자리");
  await page.getByTestId("history-button").focus();await page.keyboard.press("Enter");
  await page.screenshot({path:info.outputPath("history-desktop.png")});
  await expect(page.getByRole("dialog",{name:"대사 기록",exact:true})).toBeVisible();
  await writeFile(info.outputPath("font-report.json"),JSON.stringify({report,fonts:traffic.fonts,requests:traffic.requests},null,2));
});

test("player credits stay readable on local Korean webfonts when Google Font hosts are blocked",async({page},info)=>{
  test.setTimeout(30000);
  const traffic=watch(page);
  await page.route(google,route=>route.abort());
  await page.setViewportSize({width:390,height:600});
  await page.addInitScript(()=>{
    sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"긴 크레딧 검증",subtitle:"",start:"s",characters:[],assets:Array.from({length:30},(_,i)=>({id:`art-${i}`,kind:"background",name:`소재 ${i}`,url:"/assets/bg/title.png",provenance:{creator:"제작자",license:"허용 조건",source:"비공개 구매 기록",credit:i===0?"<script>alert(1)</script>"+"긴표기문".repeat(700):`표기문 ${i}`}})),scenes:[{id:"s",background:"title",lines:[{speaker:null,text:"현재 대사"}],ending:"끝"}]}));
  });
  await page.goto("/?preview=1");
  const report=await reportFonts(page);
  expect(traffic.requests.filter(url=>google.test(url))).toEqual([]);
  expect(report.faces.filter(face=>face.family==="Noto Serif KR"||face.family==="IBM Plex Sans KR").every(face=>face.status==="loaded")).toBe(true);
  const settings=page.getByTestId("settings-button");await expect(settings).toBeVisible();await settings.focus();await page.keyboard.press("Enter");
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  const credits=page.getByTestId("settings-panel").getByTestId("credits-button");await credits.focus();await page.keyboard.press("Enter");
  const panel=page.getByTestId("credits-panel");await expect(panel).toContainText("표기문 29");
  await page.screenshot({path:info.outputPath("credits-long-mobile.png")});
  await writeFile(info.outputPath("font-report.json"),JSON.stringify({report,fonts:traffic.fonts},null,2));
});

test("studio uses local Korean webfonts when Google Font hosts are blocked",async({page},info)=>{
  test.setTimeout(30000);
  const traffic=watch(page);
  await page.route(google,route=>route.abort());
  await page.goto("/studio.html");
  const report=await reportFonts(page);
  expect(traffic.requests.filter(url=>google.test(url))).toEqual([]);
  expect(weights(report.faces,"IBM Plex Sans KR")).toEqual(["400","500","600","700"]);
  expect(weights(report.faces,"Noto Serif KR")).toEqual(["600","700"]);
  expect(report.faces.filter(face=>face.family==="IBM Plex Sans KR"||face.family==="Noto Serif KR").every(face=>face.status==="loaded")).toBe(true);
  expect(report.plex).not.toBe(report.malgun);
  expect(report.prose).toContain("IBM Plex Sans KR");
  expect(traffic.fonts.every(font=>font.status===200&&font.type.includes("font/woff2"))).toBe(true);
  await page.screenshot({path:info.outputPath("studio-fonts.png")});
  await writeFile(info.outputPath("font-report.json"),JSON.stringify({report,fonts:traffic.fonts},null,2));
});
