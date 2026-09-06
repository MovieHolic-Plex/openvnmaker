import {spawn,type ChildProcess} from "node:child_process";

/** Owns only the child it spawned. Completion waits for closed process/stdio handles. */
export function nativeProcess(){
  let current:ChildProcess|undefined,closed:Promise<void>=Promise.resolve(),stopping:Promise<void>|undefined;
  async function stop(){
    if(stopping)return stopping;const target=current;if(!target?.pid)return;
    stopping=(async()=>{
      if(process.platform==="win32")await new Promise<void>((resolve,reject)=>{
        const killer=spawn("taskkill",["/PID",String(target.pid),"/T","/F"],{windowsHide:true,stdio:"ignore",shell:false});
        killer.once("error",reject);killer.once("close",code=>code===0||current!==target?resolve():reject(new Error(`빌드 프로세스 종료 실패 (${code})`)));
      });else if(current===target&&!target.kill())throw new Error("빌드 프로세스를 종료하지 못했습니다.");
      await closed;
    })().finally(()=>{stopping=undefined;});return stopping;
  }
  async function run(exe:string,args:string[],cwd:string,onOutput:(bytes:Buffer)=>void){
    if(current||stopping)throw new Error("이미 실행 중이거나 종료 중인 빌드 단계가 있습니다.");
    const child=spawn(exe,args,{cwd,windowsHide:true,shell:false,stdio:["ignore","pipe","pipe"]});current=child;
    let finish!:()=>void;closed=new Promise(resolve=>{finish=resolve;});
    await new Promise<void>((resolve,reject)=>{
      let failure:unknown;
      const abort=(error:unknown)=>{failure=error;void stop().catch(stopError=>{failure=stopError;});};
      const output=(bytes:Buffer)=>{try{onOutput(bytes);}catch(error){abort(error);}};
      child.stdout.on("data",output);child.stderr.on("data",output);
      const timer=setTimeout(()=>abort(new Error("빌드 단계가 15분 안에 끝나지 않았습니다.")),15*60*1000);
      child.once("error",error=>{failure=error;});
      child.once("close",code=>{clearTimeout(timer);if(current===child)current=undefined;finish();void(stopping??Promise.resolve()).catch(error=>{failure=error;}).then(()=>{failure?reject(failure):code===0?resolve():reject(new Error(`빌드 프로세스가 종료 코드 ${code}로 끝났습니다.`));});});
    });
  }
  return {run,stop,get pid(){return current?.pid;}};
}
