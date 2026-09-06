import {test} from "node:test";
import assert from "node:assert/strict";
import {nativeProcess} from "../native-process.js";

test("Windows cancellation waits for both the owned child and its descendant, then permits another run",{skip:process.platform!=="win32"},async()=>{
  const runner=nativeProcess();let receive!:(value:{pid:number;descendant:number})=>void;
  const started=new Promise<{pid:number;descendant:number}>(resolve=>{receive=resolve;});let text="";
  const code='const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{windowsHide:true,stdio:"inherit"});console.log(JSON.stringify({pid:process.pid,descendant:child.pid}));setInterval(()=>{},1000);';
  const outcome=runner.run(process.execPath,["-e",code],process.cwd(),bytes=>{text+=bytes;const line=text.split("\n").find(line=>line.startsWith("{"));if(line)receive(JSON.parse(line));}).then(()=>"complete",()=>"stopped");
  try{
    const pids=await started;assert.equal(runner.pid,pids.pid);process.kill(pids.pid,0);process.kill(pids.descendant,0);
    await runner.stop();assert.equal(await outcome,"stopped");assert.equal(runner.pid,undefined);
    for(const pid of [pids.pid,pids.descendant])assert.throws(()=>process.kill(pid,0),(error:NodeJS.ErrnoException)=>error.code==="ESRCH");
    await runner.run(process.execPath,["-e","console.log('next build')"],process.cwd(),()=>undefined);await runner.stop();
  }finally{await runner.stop();await outcome;}
});
test("a missing SDK executable reports failure and releases the process slot",async()=>{
  const runner=nativeProcess();await assert.rejects(runner.run("vnmaker-missing-executable-for-test",[],process.cwd(),()=>undefined));assert.equal(runner.pid,undefined);
  await runner.run(process.execPath,["-e","process.exit(0)"],process.cwd(),()=>undefined);
});
