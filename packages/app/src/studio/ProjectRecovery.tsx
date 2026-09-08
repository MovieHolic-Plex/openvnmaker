import {useEffect,useState} from "react";
import type {VnScript} from "@vnmaker/content";
import {readSavedProject,type SavedProject} from "./projects.js";
import {PROJECT_KEY} from "./project.js";

export function ProjectRecovery({id,onRestore}:{id:string;onRestore:(script:VnScript)=>Promise<void>}){
  const [candidate,setCandidate]=useState<SavedProject|null>(null),[status,setStatus]=useState("작품 보관함의 정상 원고를 확인하고 있습니다…"),[busy,setBusy]=useState(true);
  useEffect(()=>{let alive=true;void readSavedProject(id).then(row=>{if(!alive)return;setCandidate(row);setStatus(row?"빠른 복구 데이터는 읽지 못했지만 작품 보관함에서 정상 원고를 찾았습니다.":"이 작품의 보관함 원고를 찾지 못했습니다. JSON 또는 게임 ZIP 백업을 가져오세요.");}).catch(()=>{if(alive)setStatus("작품 보관함도 읽지 못했습니다. 현재 저장 데이터를 보존하고 외부 백업으로 복구하세요.");}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[id]);
  function downloadRaw(){
    try{const raw=localStorage.getItem(PROJECT_KEY);if(raw===null){setStatus("내려받을 빠른 복구 데이터가 없습니다.");return;}const url=URL.createObjectURL(new Blob([raw],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="vnmaker-damaged-recovery.txt";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),5000);}catch{setStatus("저장 데이터 원문을 읽지 못했습니다.");}
  }
  async function restore(){
    if(!candidate)return;
    try{
      await onRestore(candidate.script);
    }catch{setStatus("손상 원문의 보존에 실패해 복구를 중단했습니다. 원문과 외부 백업을 내려받아 보관하세요.");}
  }
  return <section className="project-recovery" aria-label="원고 복구"><h2>작품 보관함에서 복구</h2><p role="status">{status}</p>{candidate&&<p><strong>{candidate.script.title}</strong><br/>{candidate.script.scenes.length}개 장면 · 보관함 저장 {new Date(candidate.updatedAt).toLocaleString()}<br/>이 시점 이후 저장하지 못한 편집은 포함되지 않을 수 있습니다.</p>}<div><button className="studio-button" type="button" onClick={downloadRaw}>손상 데이터 원문 받기</button>{candidate&&<button className="studio-button primary" type="button" disabled={busy} onClick={restore}>이 보관함 원고로 복구</button>}</div></section>;
}
