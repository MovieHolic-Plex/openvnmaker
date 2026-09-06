import {useEffect,useRef,useState} from "react";
import type {VnScript} from "@vnmaker/content";
import type {NativeCompatibilityReport} from "./nativeCompatibility.js";

const names={high:"중요 검토",review:"검토",info:"참고"};
function ReportView({report,downloadUrl}:{report:NativeCompatibilityReport;downloadUrl?:string}){
  const [limit,setLimit]=useState(20),{analysis}=report;
  function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="native-compatibility.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="native-compatibility-report" aria-label={downloadUrl?"빌드 당시 변경 검사 결과":"출시본 변경 검사 결과"}>
    <p>{downloadUrl?"빌드 당시 원고 비교":"비교 요청 당시 편집본"}</p>
    <strong>{analysis.status==="no-detected-changes"?"정적 비교에서 변경점을 찾지 못했습니다.":"출시본과 달라진 부분을 확인하세요."}</strong>
    <p className="export-bundle-help">실제 이전 세이브를 실행한 결과가 아닙니다. 변경이 없거나 참고 항목만 있어도 호환성을 보장하지 않습니다.</p>
    <div className="native-compatibility-counts">{(["high","review","info"] as const).map(level=><span key={level} data-level={level}>{names[level]} {analysis.counts[level]}</span>)}</div>
    <small>기준 빌드 · {report.baseline.jobId}<br/>비교 원고 SHA-256 · {report.currentManuscriptHash}</small>
    {analysis.issues.length>0&&<ol>{analysis.issues.slice(0,limit).map((issue,index)=><li key={index} data-level={issue.severity}><span>{names[issue.severity]} · {issue.scope}</span><p>{issue.message}</p></li>)}</ol>}
    {limit<analysis.issues.length&&<button type="button" className="studio-button" onClick={()=>setLimit(value=>value+40)}>변경 항목 더 보기 · {limit} / {analysis.issues.length}</button>}
    {analysis.omitted>0&&<p className="export-bundle-help">전체 건수에는 포함됐지만 세부 목록에서 생략한 항목이 {analysis.omitted}개 있습니다. 중요도가 높은 순으로 최대 400개를 보관합니다.</p>}
    <details><summary>검사 범위와 한계</summary><ul>{analysis.limitations.map(text=><li key={text}>{text}</li>)}</ul></details>
    {downloadUrl?<a className="studio-button" href={downloadUrl} download>빌드 당시 검사 JSON</a>:<button className="studio-button" type="button" onClick={download}>검사 JSON 저장</button>}
  </section>;
}

export function NativeCompatibilityCompare({script,baselineId,disabled}:{script:VnScript;baselineId:string;disabled:boolean}){
  const [report,setReport]=useState<NativeCompatibilityReport|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),generation=useRef(0);
  useEffect(()=>{setReport(null);setError("");setLoading(false);return()=>{generation.current++;};},[script,baselineId]);
  async function compare(){const version=generation.current;setLoading(true);setError("");setReport(null);try{
    const response=await fetch("/api/native-build/compatibility",{method:"POST",headers:{"X-VNMaker-Studio":"1","Content-Type":"application/json",...(baselineId?{"X-VNMaker-Baseline":baselineId}:{})},body:JSON.stringify(script)});
    const result=await response.json();if(!response.ok)throw new Error(result.error??"변경 검사에 실패했습니다.");if(version===generation.current)setReport(result);
  }catch(error){if(version===generation.current)setError(error instanceof Error?error.message:String(error));}finally{if(version===generation.current)setLoading(false);}}
  return <div className="native-compatibility-compare"><button type="button" className="studio-button" disabled={disabled||loading} onClick={()=>void compare()}>{loading?"출시본 원고 비교 중…":"기준 출시본과 변경 비교"}</button>{error&&<p className="export-bundle-error" role="alert">{error}</p>}{report&&<ReportView report={report}/>}</div>;
}

export function NativeBuildComparison({jobId}:{jobId:string}){
  const [report,setReport]=useState<NativeCompatibilityReport|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  const url=`/api/native-build/jobs/${jobId}/compatibility`;
  async function show(){setLoading(true);setError("");setReport(null);try{const response=await fetch(url);const value=await response.json();if(!response.ok)throw new Error(value.error??"변경 검사 기록을 읽지 못했습니다.");setReport(value);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setLoading(false);}}
  return <div><button type="button" className="studio-button" disabled={loading} onClick={()=>void show()}>{loading?"검사 기록 확인 중…":"이 빌드의 변경 검사 보기"}</button>{error&&<p role="alert">{error}</p>}{report&&<ReportView report={report} downloadUrl={url}/>}</div>;
}
