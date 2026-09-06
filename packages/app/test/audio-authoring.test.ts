import {test} from "node:test";
import assert from "node:assert/strict";
import {audioFormat,audioPath,parseScript,validAudioUrl,type VnScript} from "@vnmaker/content";
import {describeAudio} from "../src/storage/projectAudio.js";
import {collectProjectAssets} from "../src/studio/exportBundle.js";
import {generateRenpyScript} from "../src/studio/renpyScript.js";
import {wav} from "./fixtures/wav.js";
import {zipSync} from "fflate";
import {readProjectBundle} from "../src/studio/restoreBundle.js";
test("audio preserves original bytes, identifies content and rejects unsupported WAV data",async()=>{
  const bytes=wav(),asset=await describeAudio(new Blob([bytes as Uint8Array<ArrayBuffer>],{type:"text/plain"}));
  assert.equal(asset.blob.type,"audio/wav");assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()),bytes);assert.ok(validAudioUrl(asset.path));
  const broken=bytes.slice();new DataView(broken.buffer).setUint16(34,32,true);assert.throws(()=>audioFormat(broken),/16비트/);
  assert.throws(()=>audioFormat(bytes.slice(0,50)),/잘린/);assert.throws(()=>audioFormat(new TextEncoder().encode("<html>not audio</html>")),/MP3/);
  assert.equal(validAudioUrl("https://example.com/track.mp3"),false);assert.equal(audioPath(asset.path,"bgm"),asset.path);
});
test("custom audio and per-line voice remain in exported project data and native statements",async()=>{
  const asset=await describeAudio(new Blob([wav() as Uint8Array<ArrayBuffer>]));
  const story:VnScript={title:"음원",subtitle:"",start:"s",characters:[],audioAssets:[{id:"a",name:"테스트",kind:"voice",url:asset.path,duration:2}],scenes:[{id:"s",background:"title",bgm:asset.path,lines:[{speaker:null,text:"첫 줄",sfx:asset.path,voice:asset.path},{speaker:null,text:"다음 줄",bgm:null}],ending:"끝"}]};
  parseScript(story);assert.equal(collectProjectAssets(story).filter(path=>path===asset.path).length,1);assert.ok(generateRenpyScript(story).includes(`voice "${asset.path.slice(1)}"`));
  const files=Object.fromEntries(collectProjectAssets(story).map(path=>[path.slice(1),new Uint8Array([1])]));
  files[asset.path.slice(1)]=new Uint8Array(await asset.blob.arrayBuffer());files["project.json"]=new TextEncoder().encode(JSON.stringify(story));
  await readProjectBundle(new Blob([zipSync(files) as Uint8Array<ArrayBuffer>]));
  files[asset.path.slice(1)]=wav(2,440);
  await assert.rejects(readProjectBundle(new Blob([zipSync(files) as Uint8Array<ArrayBuffer>])),/식별자/);
  assert.throws(()=>parseScript({...story,scenes:[{...story.scenes[0]!,lines:[{speaker:null,text:"x",voice:"/etc/passwd"}]}]}),/보이스/);
});
