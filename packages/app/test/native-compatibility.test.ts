import {test} from "node:test";
import assert from "node:assert/strict";
import {compareNativeManuscripts} from "../src/studio/nativeCompatibility.js";
import {arithmeticStory as story} from "./fixtures/arithmetic-story.js";
import type {VnScript} from "@vnmaker/content";

test("music fade is a playback review with equivalent omitted/default values normalized",()=>{
  assert.equal(compareNativeManuscripts(story,{...story,musicFadeSeconds:1.2}).status,"no-detected-changes");
  const result=compareNativeManuscripts(story,{...story,musicFadeSeconds:0});assert.equal(result.status,"requires-review");assert.deepEqual(result.issues.map(issue=>issue.code),["music-fade"]);assert.match(result.issues[0]!.message,/1.2초에서 0초/);
});

test("reordered or shortened menus still report changed surviving choice logic",()=>{
  const original=story.scenes[0]!,choices=original.choices!;
  const source={...story,scenes:[{...original,choices:[{...choices[0]!,text:"A"},{...choices[1]!,text:"B"}]},...story.scenes.slice(1)]};
  const mutate=(rows:typeof choices)=>({...source,scenes:[{...source.scenes[0]!,choices:rows},...source.scenes.slice(1)]});
  const reversed=[...source.scenes[0]!.choices!].reverse();
  assert.deepEqual(compareNativeManuscripts(source,mutate(reversed)).issues.map(issue=>issue.code),["choice-order"]);
  const changed=[{...reversed[0]!,add:{trust:99}},reversed[1]!];
  const reordered=compareNativeManuscripts(source,mutate(changed));assert.ok(reordered.issues.some(issue=>issue.code==="choice-order"));assert.ok(reordered.issues.some(issue=>issue.code==="choice-logic"&&issue.scope.endsWith("선택 1")));
  const shortened=compareNativeManuscripts(source,mutate([changed[0]!]));assert.ok(shortened.issues.some(issue=>issue.code==="choice-count"));assert.ok(shortened.issues.some(issue=>issue.code==="choice-logic"));
});

test("unchanged manuscripts and object key ordering never claim runtime compatibility",()=>{
  const result=compareNativeManuscripts(story,structuredClone(story));assert.equal(result.status,"no-detected-changes");assert.deepEqual(result.counts,{high:0,review:0,info:0});assert.match(result.limitations[0]!,/보장하지/);assert.equal("compatible" in result,false);
  const first={...story,flags:{a:1,b:true}},second={...story,flags:{b:true,a:1}};assert.equal(compareNativeManuscripts(first,second).issues.length,0);
});
test("state deletion, type changes and defaults explain how old earned values behave",()=>{
  const before={...story,flags:{removed:true,trust:2,label:"old"}},after={...story,flags:{trust:"two",label:"new",bonus:7}};
  const result=compareNativeManuscripts(before,after),codes=result.issues.map(issue=>issue.code);
  assert.deepEqual(new Set(codes),new Set(["flag-removed","flag-type","flag-default","flag-added"]));assert.deepEqual(result.counts,{high:2,review:1,info:1});assert.equal(result.status,"requires-review");
});
test("scene deletion and dialogue/choice reordering are distinguished from pure text edits",()=>{
  const before:VnScript={...story,scenes:story.scenes.map((scene,index)=>index?scene:{...scene,lines:[{speaker:null,text:"A"},{speaker:null,text:"B"},{speaker:null,text:"A"}]})};
  const reordered:VnScript={...before,scenes:before.scenes.filter(scene=>scene.id!=="ordinary").map((scene,index)=>index?scene:{...scene,lines:[scene.lines[1]!,scene.lines[0]!,scene.lines[2]!],choices:[...scene.choices!].reverse()})};
  const codes=compareNativeManuscripts(before,reordered).issues.map(issue=>issue.code);for(const code of ["scene-removed","line-order","choice-order"])assert.ok(codes.includes(code));
  const edited={...before,scenes:before.scenes.map((scene,index)=>index?scene:{...scene,lines:scene.lines.map(line=>({...line,text:line.text+" revised"}))})};
  const text=compareNativeManuscripts(before,edited);assert.equal(text.counts.high,0);assert.ok(text.issues.some(issue=>issue.code==="dialogue-changed"));
  const inserted={...before,scenes:before.scenes.map((scene,index)=>index?scene:{...scene,lines:[{speaker:null,text:"new"},...scene.lines]})};assert.ok(compareNativeManuscripts(before,inserted).issues.some(issue=>issue.code==="line-count"));
});
test("branch effects, exit changes and actor ordinal changes require review",()=>{
  const actors=[{id:"a",name:"A",color:"#ffffff"},{id:"b",name:"B",color:"#ffffff"}];
  const before={...story,characters:actors},after={...before,characters:[...actors].reverse(),scenes:before.scenes.map((scene,index)=>index?scene:{...scene,choices:scene.choices!.map(choice=>({...choice,add:{trust:10}})),next:"secret"})};
  const codes=compareNativeManuscripts(before,after).issues.map(issue=>issue.code);for(const code of ["choice-logic","scene-exit","actor-order"])assert.ok(codes.includes(code));
});
test("bounded reports retain high-priority findings and count omissions without claiming success",()=>{
  const base={...story,scenes:Array.from({length:800},(_,index)=>({...story.scenes[0]!,id:`scene-${index}`,choices:undefined}))} as VnScript;
  const changed={...base,scenes:base.scenes.filter((_,index)=>index>=450)};
  const result=compareNativeManuscripts(base,changed);assert.equal(result.counts.high,450);assert.equal(result.issues.length,400);assert.equal(result.omitted,50);assert.ok(result.issues.every(issue=>issue.severity==="high"));
  const arrayOrder=compareNativeManuscripts(story,{...story,scenes:[...story.scenes].reverse()});assert.equal(arrayOrder.counts.high,0);assert.deepEqual(arrayOrder.issues.map(issue=>issue.code),["scene-order"]);
});

test("stable identities distinguish duplicate-caption moves from actual cue and choice changes",()=>{
  const original=story.scenes[0]!;
  const before={...story,scenes:[{...original,lines:[{id:"a",speaker:null,text:"Same",bgm:"daily"},{id:"b",speaker:null,text:"Same",bgm:"rain"}],choices:original.choices!.map((choice,index)=>({...choice,id:`c${index}`,text:"Same"}))},...story.scenes.slice(1)]};
  const first=before.scenes[0]!;
  const moved={...before,scenes:[{...first,lines:[...first.lines].reverse(),choices:[...first.choices!].reverse()},...before.scenes.slice(1)]};
  assert.deepEqual(new Set(compareNativeManuscripts(before,moved).issues.map(issue=>issue.code)),new Set(["line-order","choice-order"]));
  const changed={...moved,scenes:[{...moved.scenes[0]!,lines:[{...moved.scenes[0]!.lines[0]!,text:"Revised",bgm:"ending"},moved.scenes[0]!.lines[1]!],choices:[{...moved.scenes[0]!.choices![0]!,text:"Revised",add:{trust:99}},moved.scenes[0]!.choices![1]!]},...moved.scenes.slice(1)]};
  const codes=new Set(compareNativeManuscripts(before,changed).issues.map(issue=>issue.code));
  for(const code of ["line-order","choice-order","dialogue-changed","line-cues","choice-logic","choice-caption"])assert.ok(codes.has(code),code);
});

test("replacing identities at unchanged counts reports removed and added entries",()=>{
  const before={...story,scenes:story.scenes.map(scene=>({...scene,lines:scene.lines.map((line,index)=>({...line,id:`l${index}`})),choices:scene.choices?.map((choice,index)=>({...choice,id:`c${index}`}))}))};
  const first=before.scenes[0]!;
  const after={...before,scenes:[{...first,lines:first.lines.map(line=>({...line,id:`new-${line.id}`})),choices:first.choices!.map(choice=>({...choice,id:`new-${choice.id}`}))},...before.scenes.slice(1)]};
  const codes=new Set(compareNativeManuscripts(before,after).issues.map(issue=>issue.code));
  for(const code of ["line-removed","line-added","choice-removed","choice-added"])assert.ok(codes.has(code),code);
  assert.ok(!codes.has("line-count"));assert.ok(!codes.has("choice-count"));
});
