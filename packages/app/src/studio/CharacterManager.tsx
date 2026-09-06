import { useState } from "react";
import { characterExpressions, characterImage, type VnScript } from "@vnmaker/content";
import { ArtImage } from "../components/ArtImage.js";
import { addCharacter, removeCharacter, updateCharacter } from "./characterOperations.js";
import { Icon } from "./Icon.js";
import "./characters.css";

export function CharacterManager({script,onChange}:{script:VnScript;onChange:(script:VnScript)=>void}){
  const[id,setId]=useState(""),[name,setName]=useState(""),[error,setError]=useState(""),[removing,setRemoving]=useState("");
  return <section className="library-view character-manager"><div className="view-heading"><div><p className="eyebrow">YOUR CAST</p><h2>이야기를 살아갈 사람들</h2><p>자신의 캐릭터를 만들고, 가져온 원화를 표정별로 연결하세요. 원화 없이 목소리와 대사만 사용하는 인물도 만들 수 있습니다.</p></div></div>
    <form className="character-create" onSubmit={event=>{event.preventDefault();try{onChange(addCharacter(script,id,name));setId("");setName("");setError("");}catch(error){setError(String(error));}}}>
      <label>캐릭터 ID<input aria-label="새 캐릭터 ID" value={id} maxLength={64} onChange={event=>setId(event.target.value)} placeholder="예: detective" required/></label><label>표시 이름<input aria-label="새 캐릭터 이름" value={name} onChange={event=>setName(event.target.value)} placeholder="예: 이서하" required/></label><button className="studio-button primary" data-testid="character-add" disabled={script.characters.length>=200}><Icon name="plus"/>캐릭터 추가</button>
    </form>{error&&<p role="alert" className="character-error">{error}</p>}
    <div className="character-grid">{script.characters.map(actor=>{const source=characterImage(actor);return <article className="character-card" key={actor.id} data-testid={`character-${actor.id}`}>
      <div className="character-portrait" style={{background:`radial-gradient(ellipse at 50% 90%,${actor.color}40,transparent 70%)`}}>{source?<ArtImage src={source} chromaKey={actor.chromaKey} alt={actor.name}/>:<div className="character-no-art">{actor.name.slice(0,1)}<small>원화 미등록 · 대사 인물</small></div>}<span>{actor.id}</span></div>
      <label className="studio-field">이름<input aria-label={`${actor.id} 이름`} value={actor.name} onChange={event=>{if(event.target.value.trim())onChange(updateCharacter(script,{...actor,name:event.target.value}));}}/></label>
      <label className="studio-field">이름표 색상<input type="color" aria-label={`${actor.id} 색상`} value={actor.color} onChange={event=>onChange(updateCharacter(script,{...actor,color:event.target.value}))}/></label>
      <label className="studio-field">설정<textarea aria-label={`${actor.id} 설정`} value={actor.bio} rows={3} onChange={event=>onChange(updateCharacter(script,{...actor,bio:event.target.value}))}/></label>
      <label className="check-field"><input type="checkbox" aria-label={`${actor.id} 녹색 배경 제거`} checked={!!actor.chromaKey} onChange={event=>{const{chromaKey,...rest}=actor;onChange(updateCharacter(script,event.target.checked?{...rest,chromaKey:"#00ff00"}:rest));}}/>녹색 배경 제거</label>
      {characterExpressions(actor).map(expression=><label key={expression} className="studio-field">{expression} 원화<select aria-label={`${actor.id} ${expression} 원화`} value={actor.expressionImages?.[expression]??""} onChange={event=>{const images={...actor.expressionImages};if(event.target.value)images[expression]=event.target.value;else delete images[expression];onChange(updateCharacter(script,{...actor,expressionImages:images}));}}><option value="">{expression==="neutral"?"미등록":"기본 원화 사용"}</option>{actor.expressionImages?.[expression]&&!script.assets?.some(asset=>asset.url===actor.expressionImages?.[expression])&&<option value={actor.expressionImages[expression]}>현재 원화</option>}{script.assets?.filter(asset=>asset.kind==="character").map(asset=><option key={asset.id} value={asset.url}>{asset.name}</option>)}</select></label>)}
      {removing===actor.id?<div className="character-delete-confirm"><p>이 인물의 대사는 내레이션으로, 배우 배치는 퇴장으로 바꿉니다. 원화 파일은 남으며 실행 취소로 복원할 수 있습니다.</p><button className="studio-button" onClick={()=>{onChange(removeCharacter(script,actor.id));setRemoving("");}}>삭제하고 내레이션으로 변환</button><button className="studio-button" onClick={()=>setRemoving("")}>취소</button></div>:<button className="studio-button" aria-label={`${actor.id} 삭제`} onClick={()=>setRemoving(actor.id)}>캐릭터 삭제</button>}
    </article>;})}</div>
  </section>;
}
