import { useEffect, useRef, useState } from "react";
import type { Line, Scene, VnScript } from "@vnmaker/content";
import { duplicateScene, moveScene, removeScene, sceneRemovalIssue } from "./sceneOperations.js";
import { splitPastedText, unrecognizedSpeakers } from "./lineOperations.js";
import { newSceneId, sceneTitle } from "./project.js";
import { Icon } from "./Icon.js";

interface Props {
  script: VnScript; scene: Scene;
  /** 편집이 거부되면 false 를 돌려준다(상한 초과 등). */
  onChange: (script: VnScript) => boolean | void;
  onSelect: (id: string) => void;
  /** 붙여넣기 대화상자에서 나눈 줄을 현재 대사 뒤에 넣는다. */
  onInsertLines?: (lines: readonly Line[]) => void;
}
export function SceneTools({script,scene,onChange,onSelect,onInsertLines}:Props){
  const [open,setOpen]=useState(false);const[replacement,setReplacement]=useState("");const[error,setError]=useState("");const dialog=useRef<HTMLDialogElement>(null);
  const [pasteOpen,setPasteOpen]=useState(false);const[pasteText,setPasteText]=useState("");const pasteDialog=useRef<HTMLDialogElement>(null);
  const index=script.scenes.findIndex(row=>row.id===scene.id);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  useEffect(()=>{if(pasteOpen){pasteDialog.current?.showModal();pasteDialog.current?.querySelector("textarea")?.focus();}else pasteDialog.current?.close();},[pasteOpen]);
  const pasted=pasteOpen?splitPastedText(pasteText,script.characters):[];
  const unknownSpeakers=pasteOpen?unrecognizedSpeakers(pasteText,script.characters):[];
  return <><div className="scene-tools" aria-label="장면 구성 편집"><button type="button" data-testid="scene-duplicate" onClick={()=>{const id=newSceneId();if(onChange(duplicateScene(script,scene.id,id))!==false)onSelect(id);}}><Icon name="scenes" size={13}/>복제</button><button type="button" aria-label="장면 목록에서 위로 이동" disabled={index===0} onClick={()=>onChange(moveScene(script,scene.id,index-1))}>↑</button><button type="button" aria-label="장면 목록에서 아래로 이동" disabled={index===script.scenes.length-1} onClick={()=>onChange(moveScene(script,scene.id,index+1))}>↓</button><small>목록 순서 · 연결 유지</small>{onInsertLines&&<button type="button" data-testid="scene-paste" onClick={()=>{setPasteText("");setPasteOpen(true);}}><Icon name="file" size={13}/>원고 붙여넣기</button>}<button type="button" data-testid="scene-delete" disabled={script.scenes.length<2} onClick={()=>{setReplacement(scene.next!==scene.id?scene.next??"":"");setError("");setOpen(true);}}><Icon name="trash" size={13}/>삭제</button></div>
  <dialog ref={dialog} className="studio-modal scene-delete-dialog" aria-label="장면 삭제" onCancel={()=>setOpen(false)}>{open&&<DeleteBody script={script} scene={scene} replacement={replacement} error={error} onReplacement={value=>{setReplacement(value);setError("");}} onClose={()=>setOpen(false)} onConfirm={()=>{try{if(onChange(removeScene(script,scene.id,replacement))!==false){onSelect(replacement);setOpen(false);}}catch(error){setError(String(error));}}}/>}</dialog>
  {onInsertLines&&<dialog ref={pasteDialog} className="studio-modal scene-paste-dialog" aria-label="원고 붙여넣기" onCancel={()=>setPasteOpen(false)}>{pasteOpen&&<><header><h2>원고 붙여넣기</h2><button aria-label="원고 붙여넣기 닫기" onClick={()=>setPasteOpen(false)}>×</button></header><p>한 줄이 대사 한 줄이 됩니다. <code>이름: 대사</code> 형식은 등장인물 이름이나 ID와 맞으면 그 인물의 대사가 되고, 모르는 이름은 그대로 내레이션으로 남습니다. 빈 줄은 건너뜁니다.</p><textarea aria-label="붙여넣을 원고" rows={10} value={pasteText} onChange={event=>setPasteText(event.target.value)} placeholder={"주인공: 오늘은 비가 올 것 같아.\n창밖으로 구름이 몰려왔다."}/><p className="field-help" role="status">{pasted.length?`${pasted.length}줄 · 화자 인식 ${pasted.filter(line=>line.speaker).length}줄 · 선택한 대사 뒤에 추가합니다.`:"나눌 줄이 없습니다."}</p>{unknownSpeakers.length>0&&<p className="field-help paste-warning" role="alert">화자로 인식하지 못한 이름: {unknownSpeakers.join(", ")} — 이 줄들은 내레이션으로 들어갑니다. 등장인물 이름이나 ID와 맞는지 확인하세요.</p>}<footer><button className="studio-button" onClick={()=>setPasteOpen(false)}>취소</button><button className="studio-button primary" data-testid="scene-paste-confirm" disabled={!pasted.length} onClick={()=>{onInsertLines(pasted);setPasteOpen(false);}}>줄로 추가</button></footer></>}</dialog>}</>;
}

/** 삭제 대화상자의 내용은 열려 있을 때만 만든다 — 닫힌 채로도 장면마다 sceneRemovalIssue 를 계산하면 장편에서 키 입력마다 비용이 든다. */
function DeleteBody({script,scene,replacement,error,onReplacement,onClose,onConfirm}:{script:VnScript;scene:Scene;replacement:string;error:string;onReplacement:(value:string)=>void;onClose:()=>void;onConfirm:()=>void}){
  const inbound=script.scenes.filter(row=>row.id!==scene.id&&(row.next===scene.id||row.choices?.some(choice=>choice.next===scene.id))).length;
  const replacementIssue=replacement ? sceneRemovalIssue(script,scene.id,replacement) : null;
  return <><header><h2>장면 삭제</h2><button aria-label="장면 삭제 닫기" onClick={onClose}>×</button></header><p><strong>{sceneTitle(scene)}</strong>의 원고를 삭제하고 연결된 {inbound}개 장면의 다음 경로를 정리합니다.{script.start===scene.id?" 작품의 시작 위치도 아래 장면으로 바뀝니다.":""}</p><label>삭제 후 연결할 장면<select aria-label="삭제 후 연결할 장면" value={replacement} onChange={event=>onReplacement(event.target.value)}><option value="">장면 선택</option>{script.scenes.filter(row=>row.id!==scene.id).map(row=>{const issue=sceneRemovalIssue(script,scene.id,row.id);return <option key={row.id} value={row.id} disabled={!!issue} title={issue??undefined}>{sceneTitle(row)}{issue?" — 자기 연결을 만들 수 없음":""}</option>;})}</select></label><p className="field-help">선택한 장면이 삭제할 장면으로 연결되어 있다면, 삭제 장면의 다음 연결·선택지·엔딩을 이어받습니다. 이미지 파일은 보관하며 실행 취소로 복원할 수 있습니다.</p>{(error||replacementIssue)&&<p role="alert">{error||replacementIssue}</p>}<footer><button className="studio-button" onClick={onClose}>취소</button><button className="studio-button danger" data-testid="scene-delete-confirm" disabled={!replacement||!!replacementIssue} onClick={onConfirm}>장면 삭제</button></footer></>;
}
