import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { script, parseScript, auditScript, lineAllowed, type StoryFlags } from "../src/index.js";
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
  for(const character of script.characters) for(const expression of ["neutral","smile","sad","surprised"] as const){const url=character.expressionImages?.[expression]; assert.ok(url?.startsWith("/assets/art/"),character.id+expression);urls.add(url!);}
  for(const asset of script.assets??[]) urls.add(asset.url);
  for(const url of urls){assert.ok(url.startsWith("/assets/art/"),url);assert.ok(existsSync(resolve(root,"."+url)),url);}
  assert.equal(urls.size,35); assert.equal(script.assetLibraryMode,"project");
  const expressions = new Set(script.scenes.flatMap(scene=>scene.lines.filter(line=>line.expression).map(line=>`${line.speaker}-${line.expression}`)));
  assert.equal(expressions.size,12,"모든 배우 표정이 실제 대사에서 사용된다");
});
