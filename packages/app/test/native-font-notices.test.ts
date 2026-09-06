import {test} from "node:test";
import assert from "node:assert/strict";
import {fontLegalNames} from "../native-font-notices.js";

test("Unicode font legal metadata is read from bounded name records",()=>{
  const text="Copyright creator",data=Buffer.from(text,"utf16le");data.swap16();
  const bytes=Buffer.alloc(46+data.length);bytes.writeUInt16BE(1,4);bytes.write("name",12);bytes.writeUInt32BE(28,20);bytes.writeUInt32BE(18+data.length,24);
  bytes.writeUInt16BE(1,30);bytes.writeUInt16BE(18,32);bytes.writeUInt16BE(3,34);bytes.writeUInt16BE(1,36);bytes.writeUInt16BE(data.length,42);data.copy(bytes,46);
  assert.deepEqual(fontLegalNames(bytes),{copyright:[text],license:[],url:[]});
  for(const truncated of [bytes.subarray(0,8),bytes.subarray(0,29),bytes.subarray(0,bytes.length-1)])assert.throws(()=>fontLegalNames(truncated),/Invalid/);
  const outside=Buffer.from(bytes);outside.writeUInt16BE(65535,44);assert.throws(()=>fontLegalNames(outside),/Invalid/);
});
