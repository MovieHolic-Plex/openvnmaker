import { useEffect, useRef, useState } from "react";
import { parseScript, type VnScript } from "@vnmaker/content";
import { listVersions, saveVersion, type ProjectVersion } from "./versions.js";
import { scriptFingerprint } from "./production.js";
import { Icon } from "./Icon.js";

export function VersionHistory({script,projectId,onRestore}:{script:VnScript;projectId:string;onRestore:(script:VnScript)=>void}){
  const[open,setOpen]=useState(false),[rows,setRows]=useState<ProjectVersion[]>([]),[label,setLabel]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const dialog=useRef<HTMLDialogElement>(null);const latest=useRef(script);latest.current=script;const lastAuto=useRef(0);
  const refresh=()=>listVersions(projectId).then(setRows).catch(()=>setError("버전 보관함을 읽지 못했습니다. JSON 백업을 사용하세요."));
  useEffect(()=>{if(open){dialog.current?.showModal();void refresh();}else dialog.current?.close();},[open,projectId]);
  useEffect(()=>{const timer=window.setTimeout(()=>{if(Date.now()-lastAuto.current<300000)return;void listVersions(projectId).then(async versions=>{const current=latest.current;if(versions[0]?.fingerprint===scriptFingerprint(current))return;await saveVersion(projectId,current,"자동 체크포인트");lastAuto.current=Date.now();}).catch(()=>setError("자동 버전 백업이 실패했습니다. 현재 원고의 JSON을 내보내 보관하세요."));},15000);return()=>window.clearTimeout(timer);},[script,projectId]);
  async function save(){setBusy(true);setError("");try{await saveVersion(projectId,script,label||"이름 없는 버전");setLabel("");await refresh();}catch{setError("버전을 저장하지 못했습니다. 기존 버전은 유지됩니다.");}finally{setBusy(false);}}
  async function restore(row:ProjectVersion){
    if(busy)return;
    setBusy(true);setError("");
    const before=latest.current;
    try{
      const next=parseScript(row.script);
      await saveVersion(projectId,before,"복원 직전 작업");
      if(latest.current!==before){setError("백업하는 동안 원고가 변경되어 복원을 중단했습니다. 현재 작업을 유지합니다.");return;}
      onRestore(structuredClone(next));setOpen(false);
    }catch{setError("복원 전 백업을 만들지 못했거나 버전이 손상됐습니다. 현재 원고를 유지합니다.");}
    finally{setBusy(false);}
  }
  return <><button type="button" className="studio-button version-button" data-testid="studio-versions" aria-label="버전 기록" onClick={()=>setOpen(true)}><Icon name="clock"/><span>버전 기록</span>{error&&<i aria-label="백업 확인 필요">!</i>}</button><dialog ref={dialog} className="studio-modal version-history" aria-label="프로젝트 버전 기록" onCancel={event=>{if(busy)event.preventDefault();else setOpen(false);}}><header><div><p className="eyebrow">PROJECT HISTORY</p><h2>되돌아갈 수 있는 작업.</h2></div><button aria-label="버전 기록 닫기" disabled={busy} onClick={()=>setOpen(false)}>×</button></header><p>현재 브라우저에 최근 20개 버전을 보관합니다. 복원하기 전의 원고도 자동으로 백업합니다.</p><div className="version-create"><input aria-label="버전 이름" placeholder="예: 3장 대사 퇴고 전" value={label} onChange={event=>setLabel(event.target.value)} maxLength={100}/><button className="studio-button primary" data-testid="version-save" disabled={busy} onClick={()=>void save()}>현재 버전 저장</button></div>{error&&<p role="alert">{error}</p>}<div className="version-list">{rows.length===0&&<p>아직 보관한 버전이 없습니다.</p>}{rows.map(row=><article key={row.id} data-testid="version-row"><div><strong>{row.label}</strong><small>{row.script.title} · {row.script.scenes.length}개 장면 · {new Date(row.createdAt).toLocaleString("ko-KR")}</small></div><button className="studio-button" disabled={busy} onClick={()=>void restore(row)}>복원</button><button className="studio-button" aria-label={`${row.label} JSON 백업`} onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(row.script,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=`version-${row.createdAt}.vn.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>JSON</button></article>)}</div></dialog></>;
}
