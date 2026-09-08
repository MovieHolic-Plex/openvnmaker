import {test, expect, type Page} from "@playwright/test";
import {writeFile} from "node:fs/promises";

const google=/fonts\.googleapis\.com|fonts\.gstatic\.com/;
const needed=[
  ["400","IBM Plex Sans KR"],
  ["500","IBM Plex Sans KR"],
  ["600","IBM Plex Sans KR"],
  ["700","IBM Plex Sans KR"],
  ["600","Noto Serif KR"],
  ["700","Noto Serif KR"],
] as const;
const weights=(faces:{family:string;weight:string;status:string}[],family:string)=>faces.filter(face=>face.family===family).map(face=>face.weight).sort();

const vnfont="vnfont:";
type FaceMark={kind:"face";family:string;weight:string;phase:"start"|"settle";tMs:number;statusAtStart:string|null;statusAfterLoad:string|null;error:string|null};
type ResourceMark={
  kind:"resource";
  name:string;
  startTime:number|null;
  fetchStart:number|null;
  requestStart:number|null;
  responseStart:number|null;
  responseEnd:number|null;
  duration:number|null;
  transferSize:number|null;
  encodedBodySize:number|null;
  tMs:number;
};
type Woff2Net={
  url:string;
  requestWallMs:number|null;
  responseWallMs:number|null;
  finishedWallMs:number|null;
  failedWallMs:number|null;
  status:number|null;
  type:string|null;
  failure:string|null;
  playwrightTiming:{startTime:number;requestStart:number;responseStart:number;responseEnd:number}|null;
};
export type FontTelemetry={
  faces:FaceMark[];
  fontsReady:{startMs:number|null;settleMs:number|null};
  resources:ResourceMark[];
  woff2:Woff2Net[];
  requests:string[];
  fonts:{url:string;status:number;type:string}[];
  report:{faces:{family:string;weight:string;status:string}[];plex:number;malgun:number;noto:number;batang:number;prose:string}|null;
  reportError:string|null;
  evaluateStartedWallMs:number|null;
  evaluateSettledWallMs:number|null;
  timeOrigin:number|null;
  reportStartPerformanceMs:number|null;
  bound:boolean;
};

let active:FontTelemetry|null=null;

function createTelemetry():FontTelemetry{
  const state:FontTelemetry={
    faces:[],
    fontsReady:{startMs:null,settleMs:null},
    resources:[],
    woff2:[],
    requests:[],
    fonts:[],
    report:null,
    reportError:null,
    evaluateStartedWallMs:null,
    evaluateSettledWallMs:null,
    timeOrigin:null,
    reportStartPerformanceMs:null,
    bound:false,
  };
  active=state;
  return state;
}

function finite(value:number){
  return Number.isFinite(value)?value:null;
}

function ingest(state:FontTelemetry,event:unknown){
  if(!event||typeof event!=="object")return;
  const mark=event as Record<string,unknown>;
  if(mark.kind==="clock"){
    if(state.timeOrigin===null&&typeof mark.timeOrigin==="number")state.timeOrigin=mark.timeOrigin;
    if(state.reportStartPerformanceMs===null&&typeof mark.reportStartPerformanceMs==="number")state.reportStartPerformanceMs=mark.reportStartPerformanceMs;
    return;
  }
  if(mark.kind==="face"){
    if(state.faces.length>=24)return;
    if(mark.phase!=="start"&&mark.phase!=="settle")return;
    if(typeof mark.tMs!=="number"||typeof mark.family!=="string"||typeof mark.weight!=="string")return;
    state.faces.push({
      kind:"face",
      family:mark.family,
      weight:mark.weight,
      phase:mark.phase,
      tMs:mark.tMs,
      statusAtStart:typeof mark.statusAtStart==="string"?mark.statusAtStart:null,
      statusAfterLoad:typeof mark.statusAfterLoad==="string"?mark.statusAfterLoad:null,
      error:typeof mark.error==="string"?mark.error:null,
    });
    return;
  }
  if(mark.kind==="fontsReady"){
    if(mark.phase==="start"&&state.fontsReady.startMs===null&&typeof mark.tMs==="number")state.fontsReady.startMs=mark.tMs;
    if(mark.phase==="settle"&&state.fontsReady.settleMs===null&&typeof mark.tMs==="number")state.fontsReady.settleMs=mark.tMs;
    return;
  }
  if(mark.kind==="resource"){
    if(state.resources.length>=12)return;
    const name=typeof mark.name==="string"?mark.name:"";
    if(typeof mark.tMs!=="number")return;
    if(state.resources.some(item=>item.name===name&&item.responseEnd===(typeof mark.responseEnd==="number"?finite(mark.responseEnd):null)))return;
    state.resources.push({
      kind:"resource",
      name,
      startTime:typeof mark.startTime==="number"?finite(mark.startTime):null,
      fetchStart:typeof mark.fetchStart==="number"?finite(mark.fetchStart):null,
      requestStart:typeof mark.requestStart==="number"?finite(mark.requestStart):null,
      responseStart:typeof mark.responseStart==="number"?finite(mark.responseStart):null,
      responseEnd:typeof mark.responseEnd==="number"?finite(mark.responseEnd):null,
      duration:typeof mark.duration==="number"?finite(mark.duration):null,
      transferSize:typeof mark.transferSize==="number"?finite(mark.transferSize):null,
      encodedBodySize:typeof mark.encodedBodySize==="number"?finite(mark.encodedBodySize):null,
      tMs:mark.tMs,
    });
  }
}

function woff2Row(state:FontTelemetry,url:string){
  const open=state.woff2.find(item=>item.url===url&&item.finishedWallMs===null&&item.failedWallMs===null);
  if(open)return open;
  if(state.woff2.length>=12)return null;
  const row:Woff2Net={url,requestWallMs:null,responseWallMs:null,finishedWallMs:null,failedWallMs:null,status:null,type:null,failure:null,playwrightTiming:null};
  state.woff2.push(row);
  return row;
}

export function fontTelemetry(state:FontTelemetry){
  const faces=needed.map(([weight,family])=>{
    const start=state.faces.find(item=>item.family===family&&item.weight===weight&&item.phase==="start")??null;
    const settle=state.faces.find(item=>item.family===family&&item.weight===weight&&item.phase==="settle")??null;
    return{
      family,
      weight,
      loadStartedMs:start?.tMs??null,
      loadSettledMs:settle?.tMs??null,
      statusAtStart:start?.statusAtStart??null,
      statusAfterLoad:settle!==null?(settle.statusAfterLoad??null):null,
      error:settle?.error??null,
      complete:settle!==null,
    };
  });
  const incomplete:string[]=[];
  for(const face of faces){
    if(face.loadStartedMs===null)incomplete.push(`face-start:${face.family}:${face.weight}`);
    if(face.loadSettledMs===null)incomplete.push(`face-settle:${face.family}:${face.weight}`);
  }
  if(state.timeOrigin===null)incomplete.push("performance.timeOrigin");
  if(state.reportStartPerformanceMs===null)incomplete.push("reportStartPerformanceMs");
  if(state.fontsReady.startMs===null)incomplete.push("fonts.ready-start");
  if(state.fontsReady.settleMs===null)incomplete.push("fonts.ready-settle");
  if(state.report===null)incomplete.push("reportFonts-return");
  for(const row of state.woff2){
    if(row.requestWallMs===null)incomplete.push(`woff2-request:${row.url}`);
    if(row.responseWallMs===null)incomplete.push(`woff2-response:${row.url}`);
    if(row.finishedWallMs===null&&row.failedWallMs===null)incomplete.push(`woff2-finished:${row.url}`);
  }
  return{
    clock:{
      browser:"performance.now() and PerformanceResourceTiming; milliseconds since performance.timeOrigin",
      timeOrigin:state.timeOrigin,
      reportStartPerformanceMs:state.reportStartPerformanceMs,
      nodeWall:"Date.now() on woff2 requestWallMs/responseWallMs/finishedWallMs/failedWallMs only",
    },
    evaluateStartedWallMs:state.evaluateStartedWallMs,
    evaluateSettledWallMs:state.evaluateSettledWallMs,
    reportError:state.reportError,
    faces,
    fontsReady:{
      startMs:state.fontsReady.startMs,
      settleMs:state.fontsReady.settleMs,
      complete:state.fontsReady.settleMs!==null,
    },
    resources:state.resources,
    woff2:state.woff2,
    incomplete,
  };
}

function attachConsole(page:Page,state:FontTelemetry){
  if(state.bound)return;
  state.bound=true;
  page.on("console",message=>{
    const text=message.text();
    if(!text.startsWith(vnfont))return;
    try{
      ingest(state,JSON.parse(text.slice(vnfont.length)));
    }catch{
      return;
    }
  });
}

export async function watch(page:Page){
  const state=createTelemetry();
  attachConsole(page,state);
  page.on("request",request=>{
    state.requests.push(request.url());
    if(!request.url().endsWith(".woff2"))return;
    const row=woff2Row(state,request.url());
    if(row&&row.requestWallMs===null)row.requestWallMs=Date.now();
  });
  page.on("response",response=>{
    if(!response.url().endsWith(".woff2"))return;
    state.fonts.push({url:response.url(),status:response.status(),type:response.headers()["content-type"]??""});
    const row=woff2Row(state,response.url());
    if(!row)return;
    row.responseWallMs=Date.now();
    row.status=response.status();
    row.type=response.headers()["content-type"]??"";
  });
  page.on("requestfinished",request=>{
    if(!request.url().endsWith(".woff2"))return;
    const row=woff2Row(state,request.url());
    if(!row)return;
    row.finishedWallMs=Date.now();
    const timing=request.timing();
    row.playwrightTiming={startTime:timing.startTime,requestStart:timing.requestStart,responseStart:timing.responseStart,responseEnd:timing.responseEnd};
  });
  page.on("requestfailed",request=>{
    if(!request.url().endsWith(".woff2"))return;
    const row=woff2Row(state,request.url());
    if(!row)return;
    row.failedWallMs=Date.now();
    row.failure=request.failure()?.errorText??"failed";
  });
  return {requests:state.requests,fonts:state.fonts,telemetry:state};
}

export async function reportFonts(page:Page,state:FontTelemetry=active??createTelemetry()){
  attachConsole(page,state);
  state.evaluateStartedWallMs=Date.now();
  try{
    const report=await page.evaluate(async faces=>{
      const emit=(event:Record<string,unknown>)=>{console.debug(`vnfont:${JSON.stringify(event)}`);};
      const reportStartPerformanceMs=performance.now();
      emit({kind:"clock",timeOrigin:performance.timeOrigin,reportStartPerformanceMs});
      const sample="한글 기록 ABC";
      const observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){
          if(!entry.name.endsWith(".woff2"))continue;
          const resource=entry as PerformanceResourceTiming;
          emit({
            kind:"resource",
            name:resource.name,
            startTime:resource.startTime,
            fetchStart:resource.fetchStart,
            requestStart:resource.requestStart,
            responseStart:resource.responseStart,
            responseEnd:resource.responseEnd,
            duration:resource.duration,
            transferSize:resource.transferSize,
            encodedBodySize:resource.encodedBodySize,
            tMs:performance.now(),
          });
        }
      });
      observer.observe({type:"resource",buffered:true});
      const loads=faces.map(([weight,family])=>{
        emit({kind:"face",phase:"start",family,weight,tMs:performance.now(),statusAtStart:[...document.fonts].find(face=>face.family.replaceAll('"',"")===family&&String(face.weight)===weight)?.status??null,statusAfterLoad:null,error:null});
        return document.fonts.load(`${weight} 48px "${family}"`,sample).then(loaded=>{
          emit({kind:"face",phase:"settle",family,weight,tMs:performance.now(),statusAtStart:null,statusAfterLoad:loaded[0]?.status??null,error:null});
          return loaded;
        },error=>{
          emit({kind:"face",phase:"settle",family,weight,tMs:performance.now(),statusAtStart:null,statusAfterLoad:"error",error:String(error)});
          throw error;
        });
      });
      await Promise.all(loads);
      emit({kind:"fontsReady",phase:"start",tMs:performance.now()});
      await document.fonts.ready;
      emit({kind:"fontsReady",phase:"settle",tMs:performance.now()});
      observer.disconnect();
      const width=(font:string)=>{const ctx=document.createElement("canvas").getContext("2d");if(!ctx)throw new Error("canvas");ctx.font=font;return ctx.measureText(sample).width;};
      return{
        faces:[...document.fonts].map(face=>({family:face.family.replaceAll('"',""),weight:String(face.weight),status:face.status})),
        plex:width('400 48px "IBM Plex Sans KR"'),
        malgun:width('400 48px "Malgun Gothic"'),
        noto:width('700 48px "Noto Serif KR"'),
        batang:width('700 48px Batang'),
        prose:getComputedStyle(document.body).fontFamily,
      };
    },needed);
    state.evaluateSettledWallMs=Date.now();
    state.report=report;
    return report;
  }catch(error){
    state.reportError=error instanceof Error?error.message:String(error);
    throw error;
  }
}

test.afterEach(async({},info)=>{
  const state=active;
  active=null;
  if(!state)return;
  if(info.status==="passed")return;
  if(state.reportError===null&&info.error)state.reportError=info.error.message??String(info.error);
  await writeFile(info.outputPath("font-report.partial.json"),JSON.stringify({
    report:state.report,
    fonts:state.fonts,
    requests:state.requests,
    telemetry:fontTelemetry(state),
  },null,2));
});

if(process.env.VNMAKER_T54_REGISTER!=="0"){
test("player history stays readable on local Korean webfonts when Google Font hosts are blocked",async({page},info)=>{
  test.setTimeout(30000);
  const traffic=await watch(page);
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
  await writeFile(info.outputPath("font-report.json"),JSON.stringify({report,fonts:traffic.fonts,requests:traffic.requests,telemetry:fontTelemetry(traffic.telemetry)},null,2));
});

test("player credits stay readable on local Korean webfonts when Google Font hosts are blocked",async({page},info)=>{
  test.setTimeout(30000);
  const traffic=await watch(page);
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
  await writeFile(info.outputPath("font-report.json"),JSON.stringify({report,fonts:traffic.fonts,telemetry:fontTelemetry(traffic.telemetry)},null,2));
});

test("studio uses local Korean webfonts when Google Font hosts are blocked",async({page},info)=>{
  test.setTimeout(30000);
  const traffic=await watch(page);
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
  await writeFile(info.outputPath("font-report.json"),JSON.stringify({report,fonts:traffic.fonts,telemetry:fontTelemetry(traffic.telemetry)},null,2));
});
}
