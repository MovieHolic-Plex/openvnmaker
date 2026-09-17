import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import type {VnScript} from "@vnmaker/content";
import {buildExportBundle} from "./exportBundle.js";
import {Icon} from "./Icon.js";
import {NativeBaselineSelector,selectedNativeBaseline} from "./NativeBaselineSelector.js";
import {NativeBuildComparison} from "./NativeCompatibilityReview.js";
import {fetchHostCapabilities} from "../api/host.js";
import "./export-bundle.css";
import "./native-build.css";

interface Job {id:string;phase:"upload"|"convert"|"lint"|"build"|"complete"|"failed"|"untracked"|"cancelling"|"cancelled";log:string;createdAt?:string;error?:string;artifact?:string;size?:number;sha256?:string;compatibilitySha256?:string;compatibilityCounts?:{high:number;review:number;info:number};baselineJobId?:string;project?:{title:string;scenes:number;lines:number}}
const phases={upload:"원본 전송",convert:"네이티브 원고 변환",lint:"원고·에셋 검사",build:"실행 게임 빌드",complete:"빌드 완료",failed:"빌드 실패",untracked:"실행 상태 미확인",cancelling:"빌드 종료 확인 중",cancelled:"빌드 취소됨"};
const KEY="vnmaker.native-build.last-job";
async function request(path:string,options?:RequestInit){
  const response=await fetch(`/api/native-build${path}`,{...options,headers:{"X-VNMaker-Studio":"1",...options?.headers}});
  let result;try{result=await response.json();}catch{throw new Error("네이티브 빌드 서버에 연결하지 못했습니다. 로컬 편집기에서 다시 시도하세요.");}
  if(!response.ok)throw new Error(result.error??`빌드 서버 오류 ${response.status}`);return result;
}
export function NativeBuildButton({script,onChange}:{script:VnScript;onChange:(script:VnScript)=>void}){
  const[open,setOpen]=useState(false),[ready,setReady]=useState(false),[checking,setChecking]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[preparing,setPreparing]=useState(false),[job,setJob]=useState<Job|null>(null),[jobId,setJobId]=useState<string|null>(()=>localStorage.getItem(KEY)),[noGateway,setNoGateway]=useState(false);
  useEffect(()=>{void fetchHostCapabilities().then(host=>{if(host&&(!host.gateway||host.native===false))setNoGateway(true);});},[]);
  const dialog=useRef<HTMLDialogElement>(null),preparation=useRef<AbortController|null>(null);
  const[history,setHistory]=useState<Job[]>([]),[unreadable,setUnreadable]=useState(0),[historyError,setHistoryError]=useState("");
  useEffect(()=>{if(!open)return;let stale=false;void request("/jobs").then(value=>{if(!stale){setHistory(value.jobs);setUnreadable(value.unreadable);setHistoryError("");}}).catch(error=>{if(!stale)setHistoryError(error.message);});return()=>{stale=true;};},[open,job?.phase]);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  useEffect(()=>()=>preparation.current?.abort(),[]);
  useEffect(()=>{
    if(!open)return;let stopped=false;setChecking(true);
    void request("/capabilities").then(value=>{if(!stopped){setReady(value.available);setMessage(value.available?"설치된 SDK로 이 컴퓨터에서 빌드합니다.":value.message);if(value.active&&!jobId){setJobId(value.active);localStorage.setItem(KEY,value.active);}}}).catch(error=>{if(!stopped){setReady(false);setError(String(error.message));}}).finally(()=>{if(!stopped)setChecking(false);});
    return()=>{stopped=true;};
  },[open]);
  useEffect(()=>{
    if(!open||!jobId)return;let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
    async function poll(){try{const next:Job=await request(`/jobs/${jobId}`);if(stopped)return;setJob(next);if(!["complete","failed","untracked","cancelled"].includes(next.phase))timer=setTimeout(()=>void poll(),1200);}catch(error){if(!stopped){setError(error instanceof Error?error.message:String(error));setJobId(null);setJob(null);localStorage.removeItem(KEY);}}}
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[open,jobId]);
  const running=!!jobId&&(!job||!["complete","failed","untracked","cancelled"].includes(job.phase)),busy=preparing||running;
  const[cancelling,setCancelling]=useState(false);
  async function cancelBuild(){if(!jobId)return;setCancelling(true);setError("");try{await request(`/jobs/${jobId}/cancel`,{method:"POST"});}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setCancelling(false);}}
  async function build(){
    const controller=new AbortController();preparation.current=controller;setPreparing(true);setError("");setJob(null);setJobId(null);localStorage.removeItem(KEY);
    try{
      const release=script.nativeSaveId?script:{...script,nativeSaveId:crypto.randomUUID().replaceAll("-","")};
      const baseline=selectedNativeBaseline(release.nativeSaveId!);
      if(release!==script)onChange(release);
      const bundle=await buildExportBundle(release,{signal:controller.signal,onProgress:progress=>setMessage(progress.phase==="assets"?`원본 확인 · ${progress.complete} / ${progress.total}`:"현재 편집본 준비 중")});
      if(bundle.blob.size>512*1024*1024)throw new Error("현재 네이티브 빌드는 512MB 이하의 게임 묶음을 지원합니다.");
      setMessage("로컬 빌드 서버에 전송 중");
      const result=await request("/jobs",{method:"POST",headers:{"Content-Type":"application/zip",...(baseline?{"X-VNMaker-Baseline":baseline}:{})},body:bundle.blob,signal:controller.signal});
      setJobId(result.id);localStorage.setItem(KEY,result.id);setJob({id:result.id,phase:"upload",log:""});
    }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));}
    finally{preparation.current=null;setPreparing(false);}
  }
  // 게이트웨이 없는 배포(호스팅 /make)에는 빌드 서버가 없다 — 버튼 자체를 숨긴다.
  if(noGateway)return null;
  return <><button className="studio-button" type="button" data-testid="studio-native-build" onClick={()=>{setError("");setOpen(true);}}><Icon name="download"/><span>실행 게임</span></button>
    {createPortal(<dialog ref={dialog} className="export-bundle-dialog native-build-dialog" aria-label="네이티브 게임 빌드" onCancel={event=>{if(preparing)event.preventDefault();else setOpen(false);}}>
      <button className="export-bundle-close" disabled={preparing} aria-label="네이티브 빌드 창 닫기" onClick={()=>setOpen(false)}><Icon name="close"/></button>
      <p className="eyebrow">NATIVE GAME · PREVIEW</p><h2>다운로드해서 실행하는 작품</h2><p className="export-bundle-description">현재 편집본을 Ren’Py 게임으로 변환하고 검사한 뒤 실행 파일을 묶습니다. Windows에서 검증 중인 배포 프리뷰입니다.</p>
      <div className="export-bundle-summary"><Icon name="scenes" size={26}/><div><strong>{job?.project?.title??script.title}</strong><span>{job?.project?.scenes??script.scenes.length}개 장면 · {job?.project?.lines??script.scenes.reduce((sum,scene)=>sum+scene.lines.length,0)}줄</span></div><span className="export-bundle-format">PC ZIP</span></div>
      <p className="export-bundle-help">{checking?"빌드 환경 확인 중…":preparing?message:job?phases[job.phase]:message}</p>
      <details className="native-release-settings"><summary>배포 ID와 업데이트</summary><p className="export-bundle-help">{script.nativeSaveId?`고정 ID: ${script.nativeSaveId}`:"첫 빌드 때 고정 ID를 만들어 원고에 저장합니다."} 같은 작품의 업데이트는 이 ID를 유지하세요. 업데이트 기준은 아래에서 자동 선택하거나 특정 완료 빌드로 고정할 수 있습니다. 다른 작품은 별도 ID를 사용하세요. 장면 삭제·순서 변경 후의 이전 세이브 복원은 별도로 검증해야 합니다.</p><label>기존 배포 ID 연결<input aria-label="네이티브 배포 ID" key={script.nativeSaveId??"unset"} defaultValue={script.nativeSaveId??""} placeholder="기존 vnmaker- 뒤의 ID" disabled={busy} onBlur={event=>{const value=event.target.value.trim();if(value===script.nativeSaveId)return;if(!value){event.target.value=script.nativeSaveId??"";return;}if(!/^[a-f0-9]{16}(?:[a-f0-9]{16})?$/.test(value)){event.target.value=script.nativeSaveId??"";setError("배포 ID는 16자리 또는 32자리 소문자 16진수여야 합니다.");return;}setError("");onChange({...script,nativeSaveId:value});}}/></label><p className="export-bundle-help">기존 출시작은 options.rpy의 config.save_directory에서 vnmaker- 뒤 ID를 복사하세요. ID를 바꾸면 다른 저장 폴더를 사용합니다. 웹 게임의 버전별 저장 정책은 그대로입니다.</p></details>
      {!checking&&!ready&&<p className="export-bundle-help">설치 안내는 저장소의 README ‘네이티브 빌드 설정’을 참고하세요.</p>}
      {script.nativeSaveId&&<NativeBaselineSelector key={script.nativeSaveId} identity={script.nativeSaveId} open={open} disabled={busy} revision={job?.phase==="complete"?job.id:""} script={script}/>}
      {busy&&<div className="export-bundle-progress" role="status"><span>{preparing?message:job?phases[job.phase]:"빌드 상태 확인 중"}</span><progress/></div>}
      {job&&<section className="native-build-status" aria-label="빌드 결과"><strong>{phases[job.phase]}</strong><small>작업 {job.id}</small>{job.error&&<p role="alert">{job.error}</p>}{job.phase==="complete"&&<a className="studio-button primary" data-testid="native-build-download" href={`/api/native-build/jobs/${job.id}/artifact`} download>실행 게임 ZIP 다운로드 · {((job.size??0)/1024/1024).toFixed(1)} MB</a>}{job.compatibilityCounts&&<p className="native-compatibility-summary">변경 검사 · 중요 검토 {job.compatibilityCounts.high} · 검토 {job.compatibilityCounts.review} · 참고 {job.compatibilityCounts.info}<br/>실제 이전 세이브 복원은 별도로 확인하세요.</p>}{job.compatibilitySha256&&<NativeBuildComparison key={job.id} jobId={job.id}/>}{job.baselineJobId&&<small>이전 빌드 기준 · {job.baselineJobId}</small>}{job.sha256&&<small>SHA-256 · {job.sha256}</small>}<details open={job.phase==="failed"}><summary>빌드 로그</summary><pre>{job.log||"빌드를 시작하고 있습니다."}</pre><a href={`/api/native-build/jobs/${job.id}/log`} download>전체 로그 다운로드</a></details></section>}
      {error&&<p className="export-bundle-error" role="alert">{error}</p>}
      <details className="native-build-history"><summary>최근 빌드 기록 · {history.length}</summary>{historyError&&<p role="alert">{historyError}</p>}{unreadable>0&&<p role="status">읽을 수 없거나 완료 정보가 부족한 기록 {unreadable}개는 표시하지 않았습니다. 원본 폴더는 유지됩니다.</p>}<div>{history.map(row=><button type="button" key={row.id} disabled={preparing} aria-pressed={row.id===jobId} data-testid={`native-history-${row.id}`} onClick={()=>{setError("");setJob(null);setJobId(row.id);localStorage.setItem(KEY,row.id);}}><strong>{row.project?.title??"원고 정보 없음"}</strong><span>{phases[row.phase]} · {row.createdAt?new Date(row.createdAt).toLocaleString("ko-KR"):row.id}</span></button>)}</div>{!history.length&&!historyError&&<p>아직 보관된 빌드가 없습니다.</p>}<small>최근 50개 작업을 표시합니다. 기록을 열어 결과 파일과 로그를 다시 받을 수 있습니다.</small></details>
      <p className="export-bundle-help">빌드 후에는 각 분기·저장·불러오기와 실제 플레이를 확인하세요. Steam 업로드와 코드 서명은 포함하지 않습니다.{running&&" 창을 닫아도 로컬 서버에서 빌드가 계속됩니다."}</p>
      <div className="export-bundle-actions">{running&&job&&job.phase!=="upload"&&<button className="studio-button" data-testid="native-build-cancel" disabled={cancelling||job.phase==="cancelling"} onClick={()=>void cancelBuild()}>{cancelling||job.phase==="cancelling"?"종료 확인 중…":"빌드 취소"}</button>}<button className="studio-button" disabled={preparing} onClick={()=>setOpen(false)}>닫기</button><button className="studio-button primary" data-testid="native-build-start" disabled={!ready||checking||busy} onClick={()=>void build()}>{busy?"빌드 중…":"현재 편집본 빌드"}</button></div>
    </dialog>,document.body)}</>;
}
