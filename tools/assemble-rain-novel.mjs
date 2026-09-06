import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const read = name => JSON.parse(fs.readFileSync(path.join(root, "docs/qa/studio-longform-2026-09-05", name), "utf8"));
const first = read("manuscript-act-1.json");
const second = read("manuscript-act-2.json");
if (first.length !== 10 || second.length !== 10) throw new Error("두 원고가 완성된 뒤 통합하세요.");
const artwork = [
  ["campus-after-rain", "비가 지난 오후의 정문", "background"],
  ["atelier-midnight", "불을 밝힌 밤의 작업실", "background"],
  ["nocturne-atrium", "비가 머문 유리별관", "background"],
  ["atelier-golden-hour", "오후의 회화 작업실", "background"],
  ["rain-library", "빗소리를 품은 도서관", "background"],
  ["midnight-cafe", "자정의 카페", "background"],
  ["rooftop-before-dawn", "새벽 전 옥상", "background"],
  ["archive-room", "오래된 소리를 보관한 방", "background"],
  ["glass-exhibition-dawn", "빈칸을 남긴 새벽 전시", "background"],
  ["campus-morning", "비가 그친 아침의 정문", "background"],
  ["morning-cafe", "강변 식당의 아침", "background"],
  ["riverside-morning", "다시 걷는 강변", "background"],
  ["rain-umbrella-cg", "우산 아래 두 손", "cg"],
  ["blue-pigment-cg", "지워도 남는 청색", "cg"],
  ["empty-sixth-frame-cg", "여섯 번째 자리", "cg"],
  ["seorin-packing-cg", "접어 둔 귀퉁이", "cg"],
  ["recorder-ribbon-cg", "풀지 못한 살구색 끈", "cg"],
  ["records-comparison-cg", "두 색의 책갈피", "cg"],
  ["glass-assembly-cg", "같은 무게를 받치는 손", "cg"],
  ["first-visitor-cg", "첫 관람객의 아침", "cg"],
];
const bg = { s01:"campus-after-rain",s02:"atelier-golden-hour",s03:"nocturne-atrium",s04:"rain-library",s05:"midnight-cafe",s06a:"atelier-midnight",s06b:"archive-room",s07:"nocturne-atrium",s08:"archive-room",s09:"rain-library",s10:"rooftop-before-dawn",s11:"midnight-cafe",s12a:"rain-library",s12b:"nocturne-atrium",s13:"atelier-midnight",s14:"nocturne-atrium",s15:"nocturne-atrium",s16:"rooftop-before-dawn",s17a:"glass-exhibition-dawn",s17b:"midnight-cafe" };
bg.s14 = "atelier-midnight";
bg.s17b = "nocturne-atrium";
const artUrl = name => `/assets/art/${name}.png`;
const characters = [
  {id:"seorin",name:"한서린",color:"#a8ccdc",bio:"23세, 회화과. 유리의 반사와 비어 있는 부분을 먼저 본다. 짧고 구체적으로 말하며, 두 해 전 전시에서 여섯 번째 패널을 직접 떼어냈다."},
  {id:"dohyun",name:"배도현",color:"#e0b38b",bio:"24세, 산업디자인과. 농담 뒤에 실무적인 배려를 감춘다. 전시 구조물과 전선을 설계했으며, 이름이 빠진 크레딧과 구형 녹음기를 기억한다."},
  {id:"mirae",name:"오미래",color:"#dca9b5",bio:"22세, 컴퓨터공학과이자 학생회 기록 담당. 직설적으로 묻되 잘못 짚은 판단은 바로잡는다. 참가 동의 기록을 관리하고 빗속 사진을 찍는다."},
].map(character => ({...character,chromaKey:"#00ff00",expressionImages:Object.fromEntries(["neutral","smile","sad","surprised"].map(expression => [expression,artUrl(`${character.id}-${expression}`)]))}));
const scenes = structuredClone([...first,...second]).map(scene => ({...scene,backgroundUrl:artUrl(bg[scene.id]),framing:"wide",artBrief:scene.artBrief || `${scene.chapter}. ${artwork.find(asset=>asset[0]===bg[scene.id])?.[1]}. 청색 유리와 앰버 조명, 인물의 감정과 소품의 움직임을 따라가는 연출.`}));
const byId = new Map(scenes.map(scene => [scene.id,scene]));
const cueMap=[];
// Fail when an edit removes or duplicates an anchor instead of silently moving a cue to another action.
function cue(sceneId,anchor,fields) {
  const scene=byId.get(sceneId);
  const matches=scene.lines.flatMap((line,index)=>line.text.startsWith(anchor)?[index]:[]);
  if(matches.length!==1) throw new Error(`연출 앵커가 유일하지 않음: ${sceneId}/${anchor}`);
  Object.assign(scene.lines[matches[0]],fields);
  cueMap.push({scene:sceneId,index:matches[0],anchor,...fields});
}
const actor=(slot,character,expression="neutral",poseUrl=null)=>({slot,character,expression,poseUrl});
const pose=character=>artUrl(character==="mirae"?"mirae-reading":`${character}-working`);
for(const [scene,start,end,art] of [
  ["s03","가까이 다가가서야","클램프 두 개가","empty-sixth-frame-cg"],
  ["s06a","가져갈 물건은 거의","서린이 종이를 접던","seorin-packing-cg"],
  ["s06b","그가 꺼낸 것은","잠깐. 켜자마자","recorder-ribbon-cg"],
  ["s08","미래가 처음 동의서에는","화면이 어두워졌다","records-comparison-cg"],
  ["s10","도현이 유리를 비스듬히","날짜는 오늘이고","blue-pigment-cg"],
  ["s12b","그녀의 손이 내 손 위가","너는 왜 오늘 왔어","rain-umbrella-cg"],
  ["s14","우리는 유리 사이 간격을","밖에서는 비가 조금","glass-assembly-cg"],
  ["s17a","첫 관람객은","두 번째로 온 학생은","first-visitor-cg"],
]) {
  cue(scene,start,{cgUrl:artUrl(art),framing:"cinematic"});
  cue(scene,end,{cgUrl:null,framing:"wide"});
}
cue("s17b","두 손이 우산 손잡이의",{cgUrl:artUrl("rain-umbrella-cg"),framing:"cinematic"});
for(const [scene,anchor,art] of [
  ["s17a","건물 밖으로 나왔을 때","campus-morning"],
  ["s17a","서린을 다시 만난 것은","riverside-morning"],
  ["s17b","밖으로 나왔을 때는","campus-morning"],
  ["s17b","강변의 작은 식당이","morning-cafe"],
  ["s17b","식당을 나와 강변 벤치에서","riverside-morning"],
]) cue(scene,anchor,{backgroundUrl:artUrl(art),framing:"wide"});
for(const [scene,anchor,sfx] of [
  ["s01","교문 안으로 들어서자","footsteps"], ["s02","창 아래 풍경이 갑자기","phone-buzz"],
  ["s02","문을 닫을 때 첫 빗방울이","rain-loop"], ["s03","유리 복도의 끝에서","rain-loop"],
  ["s04","여기 첫 번째 동의서예요","page-turn"], ["s06a","서린은 작업실 바닥에","door-open"],
  ["s06a","서린은 시험지 위에","brush-stroke"], ["s06b","자료실 문은 어깨로","door-open"],
  ["s06b","도현이 두 번째 상자에서","page-turn"], ["s07","미래가 복도 끝 조명을","footsteps"],
  ["s08","미래가 처음 동의서에는","page-turn"], ["s09","우리는 불이 켜진 계단으로","footsteps"],
  ["s10","도현이 유리를 비스듬히","brush-stroke"], ["s12a","미래가 학생증을 대자","door-open"],
  ["s12a","세 번째 번호를 읽다","page-turn"], ["s12a","측면 문이 닫히자","rain-loop"],
  ["s12b","서린이 각도를 고치자","rain-loop"], ["s13","미래가 네 사람에게 종이를","page-turn"],
  ["s14","서린은 붓에 묻은 물기를","brush-stroke"], ["s14","우리는 처마 아래에서","rain-loop"],
  ["s15","미래는 문 밖으로","footsteps"], ["s16","아래층에서 관리인의 카트가","footsteps"],
  ["s17a","응. 문부터 열자","door-open"], ["s17a","우리는 같은 속도로 걷기까지","footsteps"],
  ["s17b","강변의 작은 식당이","door-open"], ["s17b","목요일에는 작은 비가","rain-loop"],
]) cue(scene,anchor,{sfx});
for(const [scene,anchor,bgm] of [
  ["s03","가까이 다가가서야",null], ["s03","클램프 두 개가","rain"],
  ["s08","윤해원 씨의 요청이에요",null], ["s08","나는 이상하게 안도했다","rain"],
  ["s09","내가 보낸 답은 요청 아래에",null], ["s09","휴대전화를 잠가 주머니에","warm"],
  ["s13","도현은 녹음기 위에 올려 둔",null], ["s13","도현이 도면의 가운데 선을","daily"],
  ["s14","우리는 처마 아래에서",null], ["s14","미래는 설명문 초안을","warm"],
  ["s15","버튼을 누르자 스피커가",null], ["s17a","첫 관람객은",null],
  ["s17a","건물 밖으로 나왔을 때","ending"], ["s17b","우리는 이번 전시를 열지",null],
  ["s17b","강변의 작은 식당이","ending"],
]) cue(scene,anchor,{bgm});
// Work poses have explicit portrait resets; no character is left in a work pose through the ending.
for(const [scene,start,end,slot,character] of [
  ["s02","팔레트에 남은 청색은","우진아. 들어온 지","center","seorin"],
  ["s03","도현이 전원 분배함 옆에서","누군가는 명단만","left","dohyun"],
  ["s04","여기 첫 번째 동의서예요","저번 행사에서 참가자","right","mirae"],
  ["s06a","서린은 시험지 위에","그 말에 둘 다","center","seorin"],
  ["s08","공개본 번호와 원본 이름을","해원 씨는 지금 어떻게","right","mirae"],
  ["s12a","그녀는 책상에 서류를","미래의 휴대전화에는","center","mirae"],
  ["s13","그는 카드 리더를 꺼냈다","도현이 도면의 가운데 선을","left","dohyun"],
  ["s14","서린은 붓에 묻은 물기를","밖에서는 비가 조금","left","seorin"],
]) {
  cue(scene,start,{sprites:[actor(slot,character,"neutral",pose(character))]});
  cue(scene,end,{sprites:[actor(slot,character)]});
}
// A matching condition gates the whole line, including these branch-specific camera and pose cues.
cue("s07","서린의 소매 안쪽에",{framing:"close",sprites:[actor("right","seorin","smile")]});
cue("s07","도현이 상자를 내 쪽에",{framing:"close",sprites:[actor("left","dohyun","sad")]});
cue("s07","여섯 번째 패널은 내가 별관에서",{framing:"wide",sprites:[actor("left","dohyun"),actor("right","seorin")]});
cue("s13","가방은 아직 내 어깨에",{framing:"close",sprites:[actor("right","mirae","neutral",pose("mirae"))]});
cue("s13","서린이 우산 끈을 묶는 동안",{framing:"close",sprites:[actor("right","seorin","smile")]});
cue("s13","노란 책갈피가 나중에",{framing:"wide",sprites:[actor("right","mirae")]});
cue("s15","서린은 나를 불러 의자에",{framing:"close",sprites:[actor("right","seorin","smile")]});
cue("s15","도현은 나를 입구로 불러",{framing:"wide",sprites:[actor("left","dohyun","neutral",pose("dohyun"))]});
cue("s15","여기서 보니까 유리보다",{sprites:[actor("left","mirae","surprised")],framing:"wide"});
cue("s17a","전선은 안 걸렸어",{sprites:[actor("center","dohyun","smile")],framing:"close"});
cue("s17a","이제 십 분 남았어요",{sprites:[actor("center","mirae")],framing:"wide"});
cue("s17a","예전보다 가볍네",{sprites:[actor("center","seorin","smile")]});
cue("s17b","상자 들 때 그 손잡이로",{sprites:[actor("center","dohyun","smile")],framing:"close"});
cue("s17b","나중에 누가 오늘 뭐 했느냐고",{sprites:[actor("center","seorin")],framing:"wide"});
const assets = [...artwork.map(([id,name,kind])=>({id:`rain-${id}`,name,kind,url:artUrl(id)})),...characters.flatMap(character=>Object.entries(character.expressionImages).map(([expression,url])=>({id:`rain-${character.id}-${expression}`,name:`${character.name} · ${{neutral:"기본",smile:"미소",sad:"슬픔",surprised:"놀람"}[expression]}`,kind:"character",url,characterId:character.id,expression}))),...characters.map(character=>({id:`rain-${character.id}-working`,name:`${character.name} · 작업 자세`,kind:"character",url:pose(character.id),characterId:character.id}))];
const script = {title:"비가 남긴 빈칸",subtitle:"마지막 전시를 앞둔 밤, 함께 비워 두기로 한 것",start:"s01",flags:{heard_seorin:false,heard_dohyun:false,joined_mirae:false,joined_seorin:false},characters,scenes,artDirection:"비 내리는 미술대학 유리별관. 청보라 밤과 따뜻한 앰버 조명의 대비, 정교한 손그림 배경, 젖은 유리·청색 안료·살구색 케이블 끈. 인물의 옷과 외형을 장면마다 유지한다. 목소리를 복원하는 대신 빈칸을 존중하는 이야기.",assets,assetLibraryMode:"project"};
const counts=text=>[...text.replace(/\s/gu,"")].length;
const visible=(line,flags)=>(line.when?.all||[]).every(flag=>Boolean(flags[flag]))&&(line.when?.none||[]).every(flag=>!flags[flag]);
for(const scene of scenes) {
  for(const line of scene.lines) {
    if(!line.text.trim()) throw new Error(`빈 원고 행: ${scene.id}`);
    for(const flag of [...(line.when?.all||[]),...(line.when?.none||[])]) {
      if(!(flag in script.flags)) throw new Error(`정의하지 않은 조건: ${scene.id}/${flag}`);
    }
  }
}
const routes=[];
function audit(id,flags,path=[],lineCount=0,chars=0) {
  if(path.includes(id)) throw new Error(`순환 경로: ${[...path,id].join(" → ")}`);
  const scene=byId.get(id);
  if(!scene) throw new Error(`없는 장면: ${id}`);
  const actual=scene.lines.filter(line=>visible(line,flags));
  const nextPath=[...path,id], nextChars=chars+actual.reduce((sum,line)=>sum+counts(line.text),0), nextLines=lineCount+actual.length;
  if(scene.choices?.length) for(const choice of scene.choices) audit(choice.next,{...flags,...choice.set},nextPath,nextLines,nextChars);
  else if(scene.ending) {
    if(nextChars<90*320) throw new Error(`90분에 미달: ${nextPath.join(" → ")} (${nextChars}자)`);
    routes.push({path:nextPath,flags,lines:nextLines,characters:nextChars,minutes:nextChars/320});
  } else if(scene.next) audit(scene.next,flags,nextPath,nextLines,nextChars);
  else throw new Error(`엔딩 없는 막다른 장면: ${id}`);
}
audit(script.start,script.flags);
if(routes.length!==8) throw new Error(`예상과 다른 경로 수: ${routes.length}`);
fs.writeFileSync(path.join(root,"packages/content/data/rain-blank.json"),JSON.stringify(script,null,2)+"\n");
const reportDir=path.join(root,"docs/qa/studio-completion-2026-09-06");
fs.mkdirSync(reportDir,{recursive:true});
fs.writeFileSync(path.join(reportDir,"narrative-cues.json"),JSON.stringify(cueMap,null,2)+"\n");
fs.writeFileSync(path.join(reportDir,"narrative-routes.json"),JSON.stringify(routes,null,2)+"\n");
console.log(JSON.stringify({title:script.title,scenes:scenes.length,lines:scenes.reduce((sum,scene)=>sum+scene.lines.length,0),conditionalLines:scenes.reduce((sum,scene)=>sum+scene.lines.filter(line=>line.when).length,0),assets:assets.length,minMinutes:Math.min(...routes.map(route=>route.minutes)),maxMinutes:Math.max(...routes.map(route=>route.minutes))}));
