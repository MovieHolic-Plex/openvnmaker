import {test} from "node:test";
import assert from "node:assert/strict";
import {parseScript,characterImage,type VnScript} from "@vnmaker/content";
import {addCharacter,removeCharacter} from "../src/studio/characterOperations.js";
import {collectProjectAssets} from "../src/studio/exportBundle.js";
import {speakerName,speakerColor,spritesAt} from "../src/engine/selectors.js";
import {describeImage} from "../src/storage/projectAssets.js";
import {newProject} from "../src/studio/projects.js";
import {historyReducer} from "../src/studio/project.js";
import {readProjectBundle,restoreProjectBundle} from "../src/studio/restoreBundle.js";
import {createZip} from "../src/studio/zip.js";
import {zipSync} from "fflate";
import {generateRenpyScript,renpyText} from "../src/studio/renpyScript.js";
const story:VnScript={title:"사용자의 새 작품",subtitle:"",start:"start",characters:[],scenes:[{id:"start",background:"title",lines:[{speaker:null,text:"Start"}],ending:"End"}],assetLibraryMode:"project",assets:[]};
test("new projects contain no sample cast or registered artwork and switching isolates undo",()=>{
  const next=newProject("새 작품");assert.deepEqual(next.characters,[]);assert.deepEqual(next.assets,[]);assert.equal(next.scenes.length,1);
  const switched=historyReducer({past:[story],present:{...story,title:"other"},future:[]},{type:"reset",script:next});assert.equal(historyReducer(switched,{type:"undo"}).present,next);assert.equal(switched.past.length,0);assert.throws(()=>newProject(" "));
});
test("independent cast supports more than three actors, custom expressions and registered protagonists",()=>{
  let next=story;for(const id of ["me","Detective_1","witness","rival","narrator"])next=addCharacter(next,id,`이름 ${id}`);
  next={...next,characters:next.characters.map(actor=>actor.id==="me"?{...actor,color:"#123456",expressionImages:{thinking:"/assets/art/rain-library.png"}}:actor),scenes:[{...next.scenes[0]!,sprites:[{slot:"left",character:"me"}],lines:[{speaker:"me",text:"Think",expression:"thinking"}]}]};
  assert.equal(parseScript(next).characters.length,5);assert.equal(speakerName(next,"me"),"이름 me");assert.equal(speakerColor(next,"me"),"#123456");assert.equal(spritesAt(next.scenes[0]!,0)[0]?.expression,"thinking");
  assert.ok(collectProjectAssets(next).includes("/assets/art/rain-library.png"));assert.ok(!collectProjectAssets(next).some(path=>path.includes("sprite/me")));assert.equal(characterImage(next.characters[1]),undefined);
  assert.throws(()=>addCharacter(next,"constructor","bad"));assert.throws(()=>addCharacter(next,"../actor","bad"));assert.throws(()=>parseScript({...next,scenes:[{...next.scenes[0]!,lines:[{speaker:"unregistered",text:"no"}]}]}));
});
test("removing an actor preserves their text and artwork without dangling placements",()=>{
  const base=addCharacter(story,"actor","배우");const before:VnScript={...base,assets:[{id:"portrait",name:"portrait",kind:"character",characterId:"actor",expression:"neutral",url:"/assets/art/seorin-neutral.png"}],scenes:[{...base.scenes[0]!,sprites:[{slot:"left",character:"actor"}],lines:[{speaker:"actor",text:"보존할 대사",expression:"angry",sprites:[{slot:"right",character:"actor",poseUrl:"/assets/art/seorin-working.png"}]}]}]};
  const after=removeCharacter(before,"actor");assert.equal(after.scenes[0]?.lines[0]?.speaker,null);assert.equal(after.scenes[0]?.lines[0]?.text,"보존할 대사");assert.equal(after.scenes[0]?.lines[0]?.expression,undefined);assert.deepEqual(after.scenes[0]?.sprites,[{slot:"left",character:null}]);assert.equal(after.assets?.[0]?.characterId,undefined);assert.equal(before.characters.length,1);assert.equal(before.assets?.[0]?.characterId,"actor");
});
test("image identity follows bytes rather than extension or filename and rejects non-images",async()=>{
  const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);const first=await describeImage(new Blob([png],{type:"application/octet-stream"}));const second=await describeImage(new Blob([png],{type:"image/jpeg"}));assert.equal(first.path,second.path);assert.match(first.path,/^\/assets\/user\/[a-f0-9]{64}\.png$/);assert.equal(first.blob.type,"image/png");assert.deepEqual(new Uint8Array(await first.blob.arrayBuffer()),png);
  await assert.rejects(()=>describeImage(new Blob(["<html>not an image</html>"],{type:"image/png"})),/PNG/);await assert.rejects(()=>describeImage(new Blob([])),/40MB/);
});

test("bundle restoration rejects incomplete archives and changed built-in assets before writing",async()=>{
  const manuscript={path:"project.json",bytes:new TextEncoder().encode(JSON.stringify(story))};
  await assert.rejects(()=>readProjectBundle(createZip([manuscript])),/빠져/);
  await assert.rejects(()=>readProjectBundle(createZip([{path:"index.html",bytes:new Uint8Array([1])}])) ,/project.json/);
  const entries=[manuscript,...collectProjectAssets(story).map(path=>({path:path.slice(1),bytes:new Uint8Array([1,2,3])}))];
  assert.equal((await readProjectBundle(createZip(entries))).script.title,story.title);
  await assert.rejects(()=>restoreProjectBundle(createZip(entries),async()=>new Response(new Uint8Array([4,5,6]))),/기본 에셋/);
  const corrupted = new Uint8Array(await createZip(entries).arrayBuffer());
  corrupted[30+"project.json".length+10] ^= 1;
  await assert.rejects(()=>readProjectBundle(new Blob([corrupted])),/손상/);
  await assert.rejects(()=>readProjectBundle(new Blob([zipSync({"../project.json":manuscript.bytes}) as Uint8Array<ArrayBuffer>])),/안전하지/);
  await assert.rejects(()=>readProjectBundle(new Blob([new Uint8Array([1,2,3])])),/ZIP/);
});

test("native export uses literal text, native menus and explicit conditional boundaries",()=>{
  assert.equal(renpyText('이름 [flag] {b} "quote"'),JSON.stringify('이름 [[flag] {{b} "quote"'));
  const branched:VnScript={...story,flags:{remember:false},scenes:[{...story.scenes[0]!,ending:undefined,lines:[{speaker:null,text:"literal [flag] {b}",when:{all:["remember"]}}],choices:[{text:"기억한다",next:"end",set:{remember:true}}]},{id:"end",background:"title",lines:[{speaker:null,text:"끝"}],ending:"완결"}]};
  const generated=generateRenpyScript(branched);assert.match(generated,/if vn_allowed\("start", 0\):/);assert.match(generated,/menu:\n        "기억한다":/);assert.match(generated,/vn_flags = dict\(vn_flags, \*\*json.loads/);assert.doesNotMatch(generated,/vn_flags\.update/);assert.match(generated,/call screen vn_ending\("완결"\)/);assert.match(generated,/literal \[\[flag\] \{\{b\}/);
  assert.throws(()=>generateRenpyScript({...branched,scenes:branched.scenes.map((scene,index)=>index?scene:{...scene,choices:[{text:"조건",next:"end",cond:"something()"}]})}),/cond/);
});

test("narrative IDs survive editing and reorder, allocate for copies, and validate per scene",async()=>{
  const {withNarrativeIds}=await import("../src/studio/narrativeIds.js");let serial=0;const nextId=()=>`entry-${++serial}`;
  const original={...story,scenes:[{...story.scenes[0]!,choices:[{text:"Next",next:"start"}]}]};
  const assigned=withNarrativeIds(original,nextId);const first=assigned.scenes[0]!.lines[0]!.id,choice=assigned.scenes[0]!.choices![0]!.id;
  assert.ok(first);assert.ok(choice);assert.equal(original.scenes[0]!.lines[0]!.id,undefined);assert.equal(withNarrativeIds(assigned,nextId),assigned);
  const edited=withNarrativeIds({...assigned,scenes:[{...assigned.scenes[0]!,lines:[{speaker:null,text:"Inserted"},{...assigned.scenes[0]!.lines[0]!,text:"Edited"}]}]},nextId);
  assert.equal(edited.scenes[0]!.lines[1]!.id,first);assert.equal(edited.scenes[0]!.choices![0]!.id,choice);
  const copied=withNarrativeIds({...edited,scenes:[{...edited.scenes[0]!,lines:[...edited.scenes[0]!.lines,edited.scenes[0]!.lines[1]!]}]},nextId);
  assert.notEqual(copied.scenes[0]!.lines[2]!.id,first);assert.equal(copied.scenes[0]!.lines[1]!.id,first);
  assert.deepEqual(parseScript(JSON.parse(JSON.stringify(copied))),copied);
  assert.throws(()=>parseScript({...assigned,scenes:[{...assigned.scenes[0]!,lines:[assigned.scenes[0]!.lines[0]!,assigned.scenes[0]!.lines[0]!]}]}),/중복/);
  assert.throws(()=>parseScript({...assigned,scenes:[{...assigned.scenes[0]!,choices:[{id:"bad space",text:"Next",next:"start"}]}]}),/ID/);
  assert.throws(()=>withNarrativeIds(original,()=>"bad space"));
});

test("adding narrative identities does not masquerade as a cue or choice logic change",async()=>{
  const {withNarrativeIds}=await import("../src/studio/narrativeIds.js");
  const {compareNativeManuscripts}=await import("../src/studio/nativeCompatibility.js");
  const before={...story,scenes:[{...story.scenes[0]!,choices:[{text:"Next",next:"start"}]}]};
  const after=withNarrativeIds(before);assert.equal(compareNativeManuscripts(before,after).status,"no-detected-changes");
  const swapped={...after,scenes:[{...after.scenes[0]!,lines:[...after.scenes[0]!.lines,{speaker:null,text:"Second",id:"second"}].reverse()}]};
  const checked=withNarrativeIds(swapped);assert.equal(checked.scenes[0]!.lines[1]!.id,after.scenes[0]!.lines[0]!.id);
});
