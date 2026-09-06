import {test} from "node:test";
import assert from "node:assert/strict";
import {initializeEdition,EDITION_KEY,EDITION} from "../src/storage/edition.js";

function memory(entries:Record<string,string>={}){
  const map=new Map(Object.entries(entries));
  const storage:Storage={get length(){return map.size;},clear(){map.clear();},getItem:key=>map.get(key)??null,key:index=>[...map.keys()][index]??null,removeItem:key=>{map.delete(key);},setItem:(key,value)=>{map.set(key,value);}};
  return {storage,map};
}
test("missing and old edition markers preserve manuscripts, damaged bytes, checkpoints and player saves",()=>{
  for(const raw of ['{"title":"Author manuscript"}','{damaged'])for(const marker of [undefined,"older-release"]){
    const original={"vnmaker.studio.project.v1":raw,"vnmaker.studio.production.v1":"versions","vnmaker.studio.position.v1":"position","vnmaker.studio.art-recovery.v1":"receipts","vnmaker:save":"play-save","vnmaker:save:preview":"preview-save"};
    const {storage,map}=memory({...original,...(marker?{[EDITION_KEY]:marker}:{})});
    initializeEdition(storage);for(const [key,value]of Object.entries(original))assert.equal(map.get(key),value);
    assert.equal(map.get(EDITION_KEY),EDITION);
  }
});
test("first-run player initialization does not seed a sample over a possible durable manuscript",()=>{
  const {storage,map}=memory();initializeEdition(storage);assert.deepEqual([...map],[[EDITION_KEY,EDITION]]);
  initializeEdition(storage);assert.equal(storage.getItem("vnmaker.studio.project.v1"),null);
});
