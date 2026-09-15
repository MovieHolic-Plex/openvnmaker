import {test} from "node:test";
import assert from "node:assert/strict";
import {applyChoiceFlags,choiceAllowed,auditScript,parseScript,type Choice} from "@vnmaker/content";
import {arithmeticStory as story} from "./fixtures/arithmetic-story.js";
import {initialState} from "../src/engine/types.js";
import {reduce} from "../src/engine/reducer.js";
import {previewFlagsFor} from "../src/studio/editorPosition.js";
import {estimateScriptDuration} from "../src/studio/production.js";

test("numeric choices accumulate without modifying earlier states and drive gated routes",()=>{
  parseScript(story);assert.equal(auditScript(story).filter(issue=>issue.severity==="error").length,0);
  for(const [index,expected] of [[0,3],[1,-1]]){
    let state=reduce(story,initialState(story),{type:"start"});state=reduce(story,state,{type:"skipToChoice"});const before=state;
    state=reduce(story,state,{type:"choose",index:index!});assert.deepEqual(before.flags,{trust:2});state=reduce(story,state,{type:"skipToChoice"});state=reduce(story,state,{type:"choose",index:0});assert.equal(state.flags.trust,expected);assert.equal(choiceAllowed(story.scenes[2]!.choices![0]!,state.flags),expected===3);
  }
  assert.deepEqual(previewFlagsFor(story,{start:0,cost:0}),{trust:3});assert.deepEqual(previewFlagsFor(story,{start:1,cost:0}),{trust:-1});assert.deepEqual(previewFlagsFor(story,{}),{trust:2});assert.equal(estimateScriptDuration(story).incomplete,false);
});
test("invalid arithmetic is rejected atomically and unreachable arithmetic is not a false error",()=>{
  const choice:Choice={text:"x",next:"gate",add:{trust:1}};
  for(const flags of [{},{trust:true},{trust:"3"},{trust:Number.MAX_VALUE}]){const effect=typeof flags.trust==="number"?{...choice,add:{trust:Number.MAX_VALUE}}:choice;const copy=structuredClone(flags);assert.throws(()=>applyChoiceFlags(flags,effect));assert.deepEqual(flags,copy);assert.equal(choiceAllowed(effect,flags),false);}
  assert.equal(applyChoiceFlags({trust:.1},{add:{trust:.2}}).trust,.1+.2);
  const overlap={...choice,set:{trust:0}};assert.throws(()=>parseScript({...story,scenes:[{...story.scenes[0]!,choices:[overlap]}]}),/동시에/);
  const invalid={...story,flags:{trust:"bad"}};assert.ok(auditScript(invalid).some(issue=>issue.message.includes("숫자여야")));
  const guarded={...invalid,scenes:invalid.scenes.map(scene=>scene.id==="start"?{...scene,choices:[{...choice,when:{compare:[{flag:"trust",op:"eq" as const,value:3}]}},{text:"skip",next:"ordinary"}]}:scene)};
  assert.equal(auditScript(guarded).filter(issue=>issue.severity==="error").length,0);
});
