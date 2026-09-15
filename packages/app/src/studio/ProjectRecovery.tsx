import {useEffect,useState} from "react";
import type {VnScript} from "@vnmaker/content";
import {readSavedProject,type SavedProject} from "./projects.js";
import {PROJECT_KEY,salvageScript} from "./project.js";

/** 손상 원문을 복구 전에 따로 남긴다. 복구할 때마다 키가 누적돼 localStorage 한도를 잡아먹으므로 최신 3개만 둔다. */
function preserveDamagedRaw(){
  const raw=localStorage.getItem(PROJECT_KEY);
  if(raw===null)return;
  localStorage.setItem(`vnmaker.recovery-preserved.${Date.now()}.${crypto.randomUUID()}`,raw);
  const kept=Object.keys(localStorage).filter(key=>key.startsWith("vnmaker.recovery-preserved.")).sort();
  for(const stale of kept.slice(0,Math.max(0,kept.length-3)))localStorage.removeItem(stale);
}

export function ProjectRecovery({id,onRestore}:{id:string;onRestore:(script:VnScript)=>void}){
  const [candidate,setCandidate]=useState<SavedProject|null>(null),[status,setStatus]=useState("작품 보관함의 정상 원고를 확인하고 있습니다…"),[busy,setBusy]=useState(true);
  const [salvage,setSalvage]=useState<ReturnType<typeof salvageScript>>(null);
  useEffect(()=>{let alive=true;void readSavedProject(id).then(row=>{if(!alive)return;setCandidate(row);setStatus(row?"빠른 복구 데이터는 읽지 못했지만 작품 보관함에서 정상 원고를 찾았습니다.":"이 작품의 보관함 원고를 찾지 못했습니다. JSON 또는 게임 ZIP 백업을 가져오세요.");}).catch(()=>{if(alive)setStatus("작품 보관함도 읽지 못했습니다. 현재 저장 데이터를 보존하고 외부 백업으로 복구하세요.");}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[id]);
  // 상한 초과(대사 20,000자·씬 300개 등)로 읽지 못한 원고는 잘라서 되살릴 수 있다. 원문은 그대로 두고 계산만 한다.
  useEffect(()=>{try{const raw=localStorage.getItem(PROJECT_KEY);setSalvage(raw===null?null:salvageScript(JSON.parse(raw)));}catch{setSalvage(null);}},[id]);
  function downloadRaw(){
    try{const raw=localStorage.getItem(PROJECT_KEY);if(raw===null){setStatus("내려받을 빠른 복구 데이터가 없습니다.");return;}const url=URL.createObjectURL(new Blob([raw],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="vnmaker-damaged-recovery.txt";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),5000);}catch{setStatus("저장 데이터 원문을 읽지 못했습니다.");}
  }
  function restore(){
    if(!candidate)return;
    try{preserveDamagedRaw();onRestore(candidate.script);}
    catch{setStatus("손상 원문의 보존에 실패해 복구를 중단했습니다. 원문과 외부 백업을 내려받아 보관하세요.");}
  }
  function restoreSalvaged(){
    if(!salvage)return;
    try{preserveDamagedRaw();onRestore(salvage.script);}
    catch{setStatus("손상 원문의 보존에 실패해 복구를 중단했습니다. 원문과 외부 백업을 내려받아 보관하세요.");}
  }
  return <section className="project-recovery" aria-label="원고 복구"><h2>작품 보관함에서 복구</h2><p role="status">{status}</p>{candidate&&<p><strong>{candidate.script.title}</strong><br/>{candidate.script.scenes.length}개 장면 · 보관함 저장 {new Date(candidate.updatedAt).toLocaleString()}<br/>이 시점 이후 저장하지 못한 편집은 포함되지 않을 수 있습니다.</p>}
    {salvage&&<p data-testid="recovery-salvage-summary"><strong>제한을 넘은 부분을 잘라 되살릴 수 있습니다</strong><br/>{salvage.script.title} · {salvage.script.scenes.length}개 장면 · 잘리는 항목 {salvage.changes.length}개<br/><small>{salvage.changes.slice(0,3).join(" ")}{salvage.changes.length>3?` 외 ${salvage.changes.length-3}건`:""}</small></p>}
    <div><button className="studio-button" type="button" onClick={downloadRaw}>손상 데이터 원문 받기</button>{salvage&&<button className="studio-button" type="button" data-testid="recovery-salvage" onClick={restoreSalvaged}>제한 초과 부분을 잘라 복구</button>}{candidate&&<button className="studio-button primary" type="button" disabled={busy} onClick={restore}>이 보관함 원고로 복구</button>}</div></section>;
}
