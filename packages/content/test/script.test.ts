import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { script, parseScript, auditScript, lineAllowed, type StoryFlags, type VnScript } from "../src/index.js";
import { findBrokenSceneRefs, findManifestViolations } from "../src/check.js";
const count = (text: string) => Array.from(text.replace(/\s/gu, "")).length;
const byId = new Map(script.scenes.map(scene => [scene.id,scene]));
function paths(id: string, seen: string[] = [], flags:StoryFlags=script.flags??{}): { ids:string[]; chars:number; ending:string }[] {
  assert.ok(!seen.includes(id), "순환 경로 " + id);
  const scene = byId.get(id); assert.ok(scene, "없는 장면 " + id);
  const own = scene.lines.filter(line=>lineAllowed(line,flags)).reduce((total,line) => total + count(line.text),0);
  if (scene.ending) return [{ ids:[...seen,id], chars:own, ending:scene.ending }];
  const targets = scene.choices?.map(choice => ({id:choice.next,flags:{...flags,...choice.set}})) ?? (scene.next ? [{id:scene.next,flags}] : []);
  assert.ok(targets.length, "연결 누락 " + id);
  return targets.flatMap(target => paths(target.id,[...seen,id],target.flags).map(path => ({...path,chars:path.chars+own})));
}
test("새 기본 작품만 제공하며 모든 장면과 분기를 검증한다", () => {
  assert.equal(script.title,"비가 남긴 빈칸"); assert.equal(script.scenes.length,20);
  assert.equal(parseScript(script),script); assert.deepEqual(auditScript(script),[]);
  assert.deepEqual(findBrokenSceneRefs(script),[]); assert.deepEqual(findManifestViolations(script),[]);
});
test("8개의 선택 경로 모두 실제 원고 기준90분 이상이다", () => {
  const routes=paths(script.start); assert.equal(routes.length,8);
  assert.equal(new Set(routes.map(route=>route.ending)).size,2);
  for(const route of routes){ assert.equal(route.ids.length,17); assert.ok(route.chars>=28800,route.ending+": "+route.chars); assert.ok(route.chars<=36000,"불필요하게 길어진 경로 "+route.chars); }
});
test("각 씬은 충분한 실제 원고와 고유한 대사를 포함한다",()=>{
  for(const scene of script.scenes){const lines=scene.lines.map(line=>line.text.trim()); assert.ok(lines.length>=30,scene.id); assert.ok(lines.every(Boolean),scene.id); assert.ok(lines.every(line=>line.length<=220),scene.id+" 화면에 과도하게 긴 대사"); assert.ok(lines.reduce((sum,line)=>sum+count(line),0)>=1850,scene.id); assert.ok(new Set(lines).size/lines.length>.94,scene.id+" 반복 대사");}
});
test("새 원화가 모든 장면에 배치되고 외부서버 없이 파일로 존재한다",()=>{
  const root=fileURLToPath(new URL("../../app/public/",import.meta.url)); const urls=new Set<string>();
  for(const scene of script.scenes){ assert.ok(scene.backgroundUrl?.startsWith("/assets/art/"),scene.id); urls.add(scene.backgroundUrl!); if(scene.cgUrl)urls.add(scene.cgUrl); for(const line of scene.lines){if(line.backgroundUrl)urls.add(line.backgroundUrl);if(line.cgUrl)urls.add(line.cgUrl);} }
  const staged=new Set(script.scenes.flatMap(scene=>[...(scene.sprites??[]),...scene.lines.flatMap(line=>line.sprites??[])].map(sprite=>sprite.character).filter(Boolean)));
  for(const character of script.characters.filter(character=>staged.has(character.id))) for(const expression of ["neutral","smile","sad","surprised"] as const){const url=character.expressionImages?.[expression]; assert.ok(url?.startsWith("/assets/art/"),character.id+expression);urls.add(url!);}
  for(const asset of script.assets??[]) urls.add(asset.url);
  for(const url of urls){assert.ok(url.startsWith("/assets/art/"),url);assert.ok(existsSync(resolve(root,"."+url)),url);}
  assert.equal(urls.size,35); assert.equal(script.assetLibraryMode,"project");
  const expressions = new Set(script.scenes.flatMap(scene=>scene.lines.filter(line=>line.expression).map(line=>`${line.speaker}-${line.expression}`)));
  assert.equal(expressions.size,12,"모든 배우 표정이 실제 대사에서 사용된다");
});

test("scene.cg 는 kind cg 에셋 id 를 참조해야 한다", () => {
  const base = { title: "t", subtitle: "", start: "a", characters: [], scenes: [{ id: "a", background: "title", lines: [{ speaker: null, text: "x" }], ending: "e" }] };
  const withAssets = { ...base, assets: [{ id: "event-1", name: "이벤트", kind: "cg", url: "/assets/art/e1.png" }] };
  assert.ok(parseScript({ ...withAssets, scenes: [{ ...base.scenes[0], cg: "event-1" }] }));
  assert.throws(() => parseScript({ ...withAssets, scenes: [{ ...base.scenes[0], cg: "missing" }] }), /CG 에셋/);
  const bgOnly = { ...base, assets: [{ id: "bg-1", name: "배경", kind: "background", url: "/assets/art/b1.png" }] };
  assert.throws(() => parseScript({ ...bgOnly, scenes: [{ ...base.scenes[0], cg: "bg-1" }] }), /CG 에셋/);
  assert.throws(() => parseScript({ ...withAssets, scenes: [{ ...base.scenes[0], cg: "event-1", cgUrl: "/assets/art/x.png" }] }), /하나만/);
});

test("line.cgHide 는 boolean 만 받는다", () => {
  const scene = { id: "a", background: "title", lines: [{ speaker: null, text: "x", cgHide: true }], ending: "e" };
  assert.ok(parseScript({ title: "t", subtitle: "", start: "a", characters: [], scenes: [scene] }));
  assert.throws(() => parseScript({ title: "t", subtitle: "", start: "a", characters: [], scenes: [{ ...scene, lines: [{ speaker: null, text: "x", cgHide: "yes" }] }] }), /CG 숨김/);
});

test("의상은 선언된 목록 안에서만 쓸 수 있다", () => {
  const character = { id: "hero", name: "히어로", color: "#aabbcc", bio: "", outfits: ["school", "casual"], outfitImages: { school: { neutral: "/assets/art/hero-school.png" } } };
  const scene = { id: "a", background: "title", lines: [{ speaker: null, text: "x" }], sprites: [{ slot: "center", character: "hero", outfit: "casual" }], ending: "e" };
  assert.ok(parseScript({ title: "t", subtitle: "", start: "a", characters: [character], scenes: [scene] }));
  // 선언되지 않은 의상 지정 → 거부
  assert.throws(() => parseScript({ title: "t", subtitle: "", start: "a", characters: [character], scenes: [{ ...scene, sprites: [{ slot: "center", character: "hero", outfit: "armor" }] }] }), /선언되지 않은 의상/);
  // outfits 없이 outfitImages → 거부
  assert.throws(() => parseScript({ title: "t", subtitle: "", start: "a", characters: [{ ...character, outfits: undefined }], scenes: [scene] }), /선언되지 않은 의상 이미지/);
  // outfit:null 은 기본 복장 복귀 — 허용
  assert.ok(parseScript({ title: "t", subtitle: "", start: "a", characters: [character], scenes: [{ ...scene, sprites: [{ slot: "center", character: "hero", outfit: null }] }] }));
});

test("titleBgm 은 내장 곡 id 또는 프로젝트 음원 주소만 받는다 (2026-09-14, 타이틀 음악 설정)", () => {
  const base = { title: "t", subtitle: "", start: "a", characters: [], scenes: [{ id: "a", background: "title", lines: [{ speaker: null, text: "x" }], ending: "e" }] };
  assert.ok(parseScript(base));
  assert.equal(parseScript({ ...base, titleBgm: "rain" }).titleBgm, "rain");
  assert.ok(parseScript({ ...base, titleBgm: `/assets/user/${"a".repeat(64)}.mp3` }));
  assert.throws(() => parseScript({ ...base, titleBgm: "not-a-track" }), /타이틀 음악/);
  assert.throws(() => parseScript({ ...base, titleBgm: "https://evil.example/x.mp3" }), /타이틀 음악/);
  assert.throws(() => parseScript({ ...base, titleBgm: 3 }), /타이틀 음악/);
});

test("compare 조건은 플래그가 없으면 ne 를 포함해 모두 거짓이고, all 은 0·빈 문자열을 거짓으로 본다 (Ren'Py vn_condition 과 동일)", () => {
  assert.equal(lineAllowed({ when: { compare: [{ flag: "x", op: "ne", value: 1 }] } }, {}), false);
  assert.equal(lineAllowed({ when: { compare: [{ flag: "x", op: "ne", value: 1 }] } }, { x: 2 }), true);
  assert.equal(lineAllowed({ when: { compare: [{ flag: "x", op: "ne", value: 1 }] } }, { x: "1" }), true, "타입이 다르면 다른 값이다");
  assert.equal(lineAllowed({ when: { all: ["n"] } }, { n: 0 }), false);
  assert.equal(lineAllowed({ when: { all: ["s"] } }, { s: "" }), false);
  assert.equal(lineAllowed({ when: { none: ["n"] } }, { n: 0 }), true);
});

test("scene.set·scene.routes — 진입 변수와 조건 경로를 검증한다", () => {
  const base = { title: "t", subtitle: "", start: "a", characters: [], scenes: [
    { id: "a", background: "title", set: { metYuna: true }, lines: [{ speaker: null, text: "x" }], routes: [{ next: "b", when: { all: ["metYuna"] } }], next: "c" },
    { id: "b", background: "title", lines: [{ speaker: null, text: "y" }], ending: "b끝" },
    { id: "c", background: "title", lines: [{ speaker: null, text: "z" }], ending: "c끝" },
  ] };
  const parsed = parseScript(base);
  assert.equal(parsed.scenes[0]?.set?.["metYuna"], true);
  assert.equal(parsed.scenes[0]?.routes?.[0]?.next, "b");
  // 잘못된 set 값·예약어 키·빈 경로 배열·잘못된 조건을 거부한다
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], set: { bad: { nested: 1 } } }, ...base.scenes.slice(1)] }), /선택 기억 값/);
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], set: JSON.parse('{"__proto__":true}') }, ...base.scenes.slice(1)] }), /선택 기억 이름/);
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], routes: [] }, ...base.scenes.slice(1)] }), /조건부 경로/);
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], routes: [{ next: "b", when: { unknown: 1 } }] }, ...base.scenes.slice(1)] }), /표시 조건/);
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], routes: [{ next: "" }] }, ...base.scenes.slice(1)] }), /경로 연결/);
});

test("auditScript — 조건 경로의 도착지·도달성과 진입 set 을 반영한다", () => {
  const base = { title: "t", subtitle: "", start: "a", characters: [], scenes: [
    { id: "a", background: "title", lines: [{ speaker: null, text: "x" }], routes: [{ next: "b", when: { all: ["flag"] } }], next: "c" },
    { id: "b", background: "title", lines: [{ speaker: null, text: "y" }], ending: "b끝" },
    { id: "c", background: "title", lines: [{ speaker: null, text: "z" }], ending: "c끝" },
  ] };
  assert.deepEqual(auditScript(base as VnScript).filter(issue => issue.severity === "error"), []);
  // 조건 경로의 dangling 도착지는 오류
  const dangling = auditScript({ ...base, scenes: [{ ...base.scenes[0], routes: [{ next: "ghost", when: { all: ["flag"] } }] }, ...base.scenes.slice(1)] } as VnScript);
  assert.ok(dangling.some(issue => issue.severity === "error" && /조건부 경로/.test(issue.message)));
  // 진입 set 이 만든 플래그로 조건 경로가 열린다 — a.set 이 flag 를 세면 b 로 간다
  const opened = auditScript({ ...base, scenes: [{ ...base.scenes[0], set: { flag: true } }, ...base.scenes.slice(1)] } as VnScript);
  assert.deepEqual(opened.filter(issue => issue.severity === "error"), []);
  // 선택지가 있으면 경로·next·엔딩은 무시된다는 경고
  const warned = auditScript({ ...base, scenes: [{ ...base.scenes[0], choices: [{ text: "가기", next: "b" }] }, ...base.scenes.slice(1)] } as VnScript);
  assert.ok(warned.some(issue => issue.severity === "warning" && /우선/.test(issue.message)));
});
