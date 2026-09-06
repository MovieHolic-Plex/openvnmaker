import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript, script, type VnScript } from "@vnmaker/content";
import { reduce } from "../src/engine/reducer.js";
import { initialState } from "../src/engine/types.js";
import { bgmAt, cgAt, framingAt, spritesAt } from "../src/engine/selectors.js";
import { estimateScriptDuration } from "../src/studio/production.js";
import { duplicateScene, moveScene, removeScene } from "../src/studio/sceneOperations.js";
import { listSlots, readAutoSlot, readSlot, writeAutoSlot, writeSlot, latestSave } from "../src/storage/persist.js";
import { parseEditorPosition, previewFlagsFor } from "../src/studio/editorPosition.js";

test("corrupt editor positions recover and cleared preview choices rebuild flags from the current manuscript",()=>{
  for(const raw of ["null","[]","1",'"bad"',"broken"])assert.deepEqual(parseEditorPosition(raw),{});
  assert.deepEqual(parseEditorPosition('{"lineIndex":-3,"sceneId":[],"choices":{"x":"0"}}'),{focusMode:false,choices:{}});
  const novel={...story,scenes:[{...story.scenes[0]!,choices:[{text:"A",next:"merge",set:{remembered:true}},{text:"B",next:"merge",set:{other:true}}]},story.scenes[1]!]};
  assert.deepEqual(previewFlagsFor(novel,{choice:0}),{remembered:true});
  assert.deepEqual(previewFlagsFor(novel,{choice:1}),{remembered:false,other:true});
  assert.deepEqual(previewFlagsFor(novel,{choice:-1}),{remembered:false});
});

const story:VnScript={...script,title:"選択記録",assets:[],flags:{remembered:false},start:"choice",scenes:[
  {id:"choice",background:"title",lines:[{speaker:null,text:"選ぶ"}],choices:[{text:"覚える",next:"merge",set:{remembered:true}},{text:"忘れる",next:"merge",set:{remembered:false}}]},
  {id:"merge",background:"title",bgm:"daily",sprites:[{slot:"left",character:"seorin"}],lines:[
    {speaker:null,text:"AAAA",when:{all:["remembered"]},cgUrl:"/assets/art/rain-umbrella-cg.png",sprites:[{slot:"left",character:null}],bgm:null},
    {speaker:null,text:"BBBBBBBB",when:{none:["remembered"]},framing:"close"},
    {speaker:"seorin",text:"C",cgUrl:null,sprites:[{slot:"left",character:"seorin",poseUrl:"/assets/art/seorin-working.png"}]},
    {speaker:"seorin",text:"D",expression:"smile",sprites:[{slot:"left",character:"seorin",poseUrl:null}]},
  ],ending:"終"},
]};
test("choices persist across merge, save/restore, conditional dialogue, history and all visual cues",()=>{
  let state=reduce(story,initialState(story),{type:"start"});state=reduce(story,state,{type:"skipScene"});state=reduce(story,state,{type:"choose",index:0});
  assert.equal(state.flags.remembered,true);assert.equal(state.lineIndex,0);
  const restored=reduce(story,initialState(story),{type:"restore",sceneId:state.sceneId,lineIndex:state.lineIndex,flags:state.flags,affection:state.affection,history:state.history});
  assert.deepEqual(restored.flags,state.flags);assert.deepEqual(restored.history,state.history);
  const scene=story.scenes[1]!;
  assert.equal(cgAt(scene,1,restored.flags),"/assets/art/rain-umbrella-cg.png");assert.equal(framingAt(scene,1,restored.flags),"wide");assert.equal(bgmAt(scene,1,restored.flags),null);assert.deepEqual(spritesAt(scene,1,restored.flags),[]);
  state=reduce(story,restored,{type:"advance"});assert.equal(state.lineIndex,2);assert.equal(spritesAt(scene,2,state.flags)[0]?.poseUrl,"/assets/art/seorin-working.png");
  state=reduce(story,state,{type:"skipScene"});assert.equal(state.phase,"ending");assert.ok(!state.history.some(row=>row.text==="BBBBBBBB"));
  const actor=spritesAt(scene,3,state.flags)[0]!;assert.equal(actor.poseUrl,null);assert.equal(actor.expression,"smile");
  const alternate=reduce(story,reduce(story,reduce(story,initialState(story),{type:"start"}),{type:"skipScene"}),{type:"choose",index:1});assert.equal(alternate.lineIndex,1);assert.equal(cgAt(scene,1,alternate.flags),undefined);
});
test("runtime estimates count only the rows actually read after each choice",()=>{
  const estimate=estimateScriptDuration(story,1);assert.equal(estimate.minMinutes,8);assert.equal(estimate.maxMinutes,12);
});
test("conditional empty cycles report an error instead of overflowing, and saved choice phase is restored",()=>{
  const loop:VnScript={...story,start:"x",scenes:[{id:"x",background:"title",lines:[{speaker:null,text:"hidden",when:{all:["missing"]}}],next:"x"}]};
  assert.match(reduce(loop,initialState(loop),{type:"start"}).error!,/순환/);
  const restored=reduce(story,initialState(story),{type:"restore",sceneId:"choice",lineIndex:0,affection:0,phase:"choice"});assert.equal(restored.phase,"choice");
});
test("scene duplicate/move/delete preserves branch payloads, remaps incoming links and remains immutable",()=>{
  const copy=duplicateScene(story,"choice","copy");assert.equal(copy.scenes[0]!.next,"copy");assert.equal(copy.scenes[0]!.choices,undefined);assert.deepEqual(copy.scenes[1]!.choices,story.scenes[0]!.choices);
  const moved=moveScene(copy,"copy",2);assert.equal(moved.start,story.start);assert.equal(moved.scenes.find(scene=>scene.id==="choice")!.next,"copy");
  const deleted=removeScene(moved,"copy","merge");assert.equal(deleted.scenes[0]!.next,"merge");assert.deepEqual(story.scenes[0]!.choices?.[0]?.set,{remembered:true});
  const withoutStart=removeScene(story,"choice","merge");assert.equal(withoutStart.start,"merge");assert.throws(()=>removeScene(withoutStart,"merge","merge"));
});
test("parser rejects unsafe pose URLs, malformed conditions and prototype flags",()=>{
  for(const line of [{...story.scenes[1]!.lines[0]!,sprites:[{slot:"left",character:"seorin",poseUrl:"https://tracker/x.png"}]},{...story.scenes[1]!.lines[0]!,when:{all:"x"}}])assert.throws(()=>parseScript({...story,scenes:[{...story.scenes[0]!,lines:[line]}]}));
  assert.throws(()=>parseScript({...story,flags:JSON.parse('{"__proto__":true}')}));
});
test("slots preserve manuscript, choice and history snapshots; namespaces and quota failures cannot overwrite other saves",()=>{
  const data=new Map<string,string>();let blocked=false;
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(blocked)throw new Error("quota");data.set(key,value);}};
  Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:storage}});
  const save={sceneId:"merge",lineIndex:0,affection:0,savedAt:3,phase:"scene" as const,flags:{remembered:true},history:[{speaker:null,text:"prior"}],script:story,preview:"AAAA",chapter:"merge",thumbnail:null};
  assert.equal(writeSlot(0,save),true);assert.equal(readSlot(0)?.script?.title,story.title);assert.deepEqual(readSlot(0)?.history,save.history);assert.deepEqual(readSlot(0)?.flags,save.flags);
  assert.equal(writeAutoSlot({...save,savedAt:4},"preview"),true);assert.equal(readAutoSlot(),null);assert.equal(readAutoSlot("preview")?.savedAt,4);assert.equal(latestSave()?.savedAt,3);
  assert.equal(writeSlot(0,{...save,savedAt:5},"bundle-abc"),true);assert.equal(readSlot(0)?.savedAt,3);assert.equal(listSlots("bundle-other").filter(Boolean).length,0);
  blocked=true;assert.equal(writeSlot(0,{...save,savedAt:99}),false);assert.equal(readSlot(0)?.savedAt,3);assert.equal(writeAutoSlot(save),false);
});

test("saved history preserves valid source labels and sanitizes malformed legacy metadata",()=>{
  const data=new Map<string,string>();Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)}}});
  const history=[{speaker:null,text:"현재",sceneId:"a",chapter:"첫 장"},{speaker:null,text:"예전"},{speaker:null,text:"손상된 메타데이터",chapter:{title:"bad"},sceneId:7}];
  const save={sceneId:"merge",lineIndex:0,affection:0,savedAt:3,history:history as unknown as NonNullable<import("../src/engine/types.js").SaveData["history"]>,script:story,preview:"",chapter:null,thumbnail:null};
  assert.equal(writeSlot(0,save),true);
  assert.deepEqual(readSlot(0)?.history,[history[0],history[1],{speaker:null,text:"손상된 메타데이터"}]);
});

test("library archive keeps invalid manuscript fields and rejects lossy JSON conversions",async()=>{
  const {serializeLibraryArchive}=await import("../src/studio/libraryArchive.js");
  const records=[{id:"bad",script:{unexpected:[null,"原文",17,false],title:{broken:true}},updatedAt:1}];
  assert.deepEqual(JSON.parse(serializeLibraryArchive(records)),{format:"vnmaker-library-archive",version:1,records});
  const cyclic:{self?:unknown}={};cyclic.self=cyclic;
  for(const value of [undefined,NaN,Infinity,-0,1n,new Date(),new Map(),new Uint8Array([1,2]),cyclic,[,1]])assert.throws(()=>serializeLibraryArchive([{id:"bad",value}]));
  assert.throws(()=>serializeLibraryArchive([{toJSON(){throw new Error("must not execute");}}]));
});

test("manuscript snapshot comparison ignores object key order but detects narrative changes",async()=>{
  const {manuscriptKey}=await import("../src/storage/manuscriptKey.js");
  assert.equal(manuscriptKey({a:1,b:{z:2,y:3}}),manuscriptKey({b:{y:3,z:2},a:1}));
  assert.notEqual(manuscriptKey({lines:["old","next"]}),manuscriptKey({lines:["inserted","old","next"]}));
  assert.notEqual(manuscriptKey({text:"old"}),manuscriptKey({text:"new"}));
});
