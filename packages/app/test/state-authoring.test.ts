import {test} from "node:test";
import assert from "node:assert/strict";
import {auditScript,choiceAllowed,lineAllowed,parseScript,type VnScript} from "@vnmaker/content";
import {reduce} from "../src/engine/reducer.js";
import {initialState} from "../src/engine/types.js";
import {generateRenpyScript} from "../src/studio/renpyScript.js";
import {estimateScriptDuration} from "../src/studio/production.js";
import {story} from "./fixtures/state-story.js";
test("typed conditions are strict and unknown flags cannot satisfy comparisons",()=>{
  assert.equal(lineAllowed({when:{compare:[{flag:"x",op:"eq",value:1}]}},{x:true}),false);
  assert.equal(lineAllowed({when:{compare:[{flag:"x",op:"ne",value:1}]}},{}),false);
  for(const [op,value,expected] of [["gt",2,true],["gte",3,true],["lt",3,false],["lte",3,true],["eq",3,true],["ne",3,false]] as const)assert.equal(lineAllowed({when:{compare:[{flag:"x",op,value}]}},{x:3}),expected);
  assert.equal(lineAllowed({when:{compare:[{flag:"x",op:"gte",value:1}]}},{x:"3"}),false);
  assert.equal(lineAllowed({when:{all:["constructor"]}},{}),false);
  assert.throws(()=>parseScript({...story,scenes:[{...story.scenes[0]!,choices:[{text:"bad",next:"gate",cond:"trust > 0"}]}]}),/cond/);
  assert.throws(()=>parseScript({...story,scenes:[{...story.scenes[0]!,choices:[{text:"bad",next:"gate",when:{compare:[{flag:"trust",op:"gte",value:"three"}]}}]}]}),/数字|숫자/);
});
test("unavailable choices cannot be selected even with a direct reducer action; restoring changes their availability",()=>{
  parseScript(story);let state=reduce(story,initialState(story),{type:"start"});state=reduce(story,state,{type:"skipScene"});state=reduce(story,state,{type:"choose",index:1});
  assert.equal(state.lineIndex,1);state=reduce(story,state,{type:"skipScene"});assert.equal(choiceAllowed(story.scenes[1]!.choices![0]!,state.flags),false);assert.equal(reduce(story,state,{type:"choose",index:0}),state);
  state=reduce(story,state,{type:"restore",sceneId:"gate",lineIndex:1,phase:"choice",affection:0,flags:{trust:3,route:"ally",letter:true}});state=reduce(story,state,{type:"choose",index:0});assert.equal(state.sceneId,"secret");
});
test("audit finds reachable conditional dead ends and duration excludes unavailable routes",()=>{
  assert.equal(auditScript(story).filter(issue=>issue.severity==="error").length,0);
  const blocked={...story,scenes:story.scenes.map(scene=>scene.id==="gate"?{...scene,choices:[scene.choices![0]!]}:scene)};
  assert.ok(auditScript(blocked).some(issue=>issue.message.includes("모두 닫힙니다")));
  assert.throws(()=>generateRenpyScript(blocked),/모두 닫힙니다/);
  assert.equal(estimateScriptDuration(story).incomplete,false);
  assert.match(generateRenpyScript(story),/if vn_condition/);
});
