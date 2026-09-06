import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {nativeIdentity} from "../native-identity.js";
import {arithmeticStory as story} from "./fixtures/arithmetic-story.js";

test("native release namespace survives manuscript edits and separates other games",()=>{
  const original={...story,nativeSaveId:"0123456789abcdef0123456789abcdef"};
  const revision={...original,title:"Changed title",scenes:original.scenes.map((scene,i)=>i?scene:{...scene,lines:[{speaker:null,text:"Revised opening"}]})};
  assert.equal(nativeIdentity(original).identity,nativeIdentity(revision).identity);
  assert.notEqual(nativeIdentity(original).manuscriptHash,nativeIdentity(revision).manuscriptHash);
  assert.notEqual(nativeIdentity(original).identity,nativeIdentity({...revision,nativeSaveId:"fedcba9876543210"}).identity);
  assert.equal(nativeIdentity(original).stable,true);
});
test("legacy release identity can be pinned without moving existing saves",()=>{
  const legacy=createHash("sha256").update(JSON.stringify(story)).digest("hex").slice(0,16);
  assert.equal(nativeIdentity(story).identity,legacy);assert.equal(nativeIdentity(story).stable,false);
  assert.equal(nativeIdentity({...story,nativeSaveId:legacy,title:"Update"}).identity,legacy);
  for(const nativeSaveId of ["../saves","A".repeat(16),"a".repeat(17),"",null,123])assert.throws(()=>nativeIdentity({...story,nativeSaveId} as never));
});
