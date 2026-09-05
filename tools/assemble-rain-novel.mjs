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
];
const bg = { s01:"campus-after-rain",s02:"atelier-golden-hour",s03:"nocturne-atrium",s04:"rain-library",s05:"midnight-cafe",s06a:"atelier-midnight",s06b:"archive-room",s07:"nocturne-atrium",s08:"archive-room",s09:"rain-library",s10:"rooftop-before-dawn",s11:"midnight-cafe",s12a:"rain-library",s12b:"nocturne-atrium",s13:"atelier-midnight",s14:"nocturne-atrium",s15:"nocturne-atrium",s16:"rooftop-before-dawn",s17a:"glass-exhibition-dawn",s17b:"midnight-cafe" };
const cg = {s10:[26,28,"blue-pigment-cg"],s12b:[21,24,"rain-umbrella-cg"]};
bg.s14 = "atelier-midnight";
bg.s17b = "nocturne-atrium";
const backgroundCues = { s17a:{26:"campus-morning",32:"riverside-morning"},s17b:{21:"campus-morning",23:"morning-cafe",28:"riverside-morning"} };
const artUrl = name => `/assets/art/${name}.png`;
const characters = [
  {id:"seorin",name:"한서린",color:"#a8ccdc",bio:"23세, 회화과. 유리의 반사와 비어 있는 부분을 먼저 본다. 짧고 구체적으로 말하며, 두 해 전 전시에서 여섯 번째 패널을 직접 떼어냈다."},
  {id:"dohyun",name:"배도현",color:"#e0b38b",bio:"24세, 산업디자인과. 농담 뒤에 실무적인 배려를 감춘다. 전시 구조물과 전선을 설계했으며, 이름이 빠진 크레딧과 구형 녹음기를 기억한다."},
  {id:"mirae",name:"오미래",color:"#dca9b5",bio:"22세, 컴퓨터공학과이자 학생회 기록 담당. 직설적으로 묻되 잘못 짚은 판단은 바로잡는다. 참가 동의 기록을 관리하고 빗속 사진을 찍는다."},
].map(character => ({...character,chromaKey:"#00ff00",expressionImages:Object.fromEntries(["neutral","smile","sad","surprised"].map(expression => [expression,artUrl(`${character.id}-${expression}`)]))}));
const scenes = [...first,...second].map(scene => ({...scene,backgroundUrl:artUrl(bg[scene.id]),lines:scene.lines.map((line,index)=>({...line,...(backgroundCues[scene.id]?.[index]?{backgroundUrl:artUrl(backgroundCues[scene.id][index])}:{}),...(cg[scene.id] && index===cg[scene.id][0]?{cgUrl:artUrl(cg[scene.id][2])}:{}),...(cg[scene.id] && index===cg[scene.id][1]?{cgUrl:null}:{}),...(scene.id==="s17b" && index===39?{cgUrl:artUrl("rain-umbrella-cg")}:{})})),artBrief:scene.artBrief || `${scene.chapter}. ${artwork.find(asset=>asset[0]===bg[scene.id])?.[1]}. 청색 유리와 앰버 조명, 인물의 감정과 소품의 움직임을 따라가는 연출.`}));
const assets = [...artwork.map(([id,name,kind])=>({id:`rain-${id}`,name,kind,url:artUrl(id)})),...characters.flatMap(character=>Object.entries(character.expressionImages).map(([expression,url])=>({id:`rain-${character.id}-${expression}`,name:`${character.name} · ${{neutral:"기본",smile:"미소",sad:"슬픔",surprised:"놀람"}[expression]}`,kind:"character",url,characterId:character.id,expression})))];
const script = {title:"비가 남긴 빈칸",subtitle:"마지막 전시를 앞둔 밤, 함께 비워 두기로 한 것",start:"s01",characters,scenes,artDirection:"비 내리는 미술대학 유리별관. 청보라 밤과 따뜻한 앰버 조명의 대비, 정교한 손그림 배경, 젖은 유리·청색 안료·살구색 케이블 끈. 인물의 옷과 외형을 장면마다 유지한다. 목소리를 복원하는 대신 빈칸을 존중하는 이야기.",assets,assetLibraryMode:"project"};
fs.writeFileSync(path.join(root,"packages/content/data/rain-blank.json"),JSON.stringify(script,null,2)+"\n");
console.log(JSON.stringify({title:script.title,scenes:scenes.length,lines:scenes.reduce((sum,scene)=>sum+scene.lines.length,0),characters:scenes.reduce((sum,scene)=>sum+scene.lines.reduce((n,line)=>n+Array.from(line.text.replace(/\s/gu,"")).length,0),0),assets:assets.length}));
