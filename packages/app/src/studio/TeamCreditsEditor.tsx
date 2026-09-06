import type { VnScript } from "@vnmaker/content";
import "./team-credits.css";

export function TeamCreditsEditor({script, onEdit}: {script: VnScript; onEdit: (script: VnScript, group?: string) => void}) {
  const rows = script.credits ?? [];
  function change(index: number, field: "role" | "names", value: string) {
    onEdit({...script, credits: rows.map((row,i)=>i===index?{...row,[field]:value}:row)},`credits-${index}-${field}`);
  }
  function move(index: number, direction: number) {
    const next = [...rows]; const target=index+direction;
    if(target<0 || target>=next.length) return;
    [next[index],next[target]]=[next[target]!,next[index]!]; onEdit({...script,credits:next});
  }
  return <section className="team-credits-editor" aria-label="제작진 크레딧" data-testid="team-credits-editor">
    <header><div><p>TEAM CREDITS</p><h2>함께 만든 사람들</h2></div><button className="studio-button" disabled={rows.length>=100} onClick={()=>onEdit({...script,credits:[...rows,{role:"",names:""}]})}>제작진 항목 추가</button></header>
    <p>시나리오, 원화, 음악, 번역 등 역할과 이름을 기록하세요. 위에서부터 웹·네이티브 게임의 크레딧에 표시됩니다. 이름이 빈 항목은 게임 화면에서 생략됩니다.</p>
    {!rows.length && <p className="team-credits-empty">아직 등록한 제작진이 없습니다.</p>}
    {rows.map((row,index)=><article key={index} data-testid={`team-credit-${index}`}><label>역할<input aria-label={`제작진 ${index+1} 역할`} maxLength={120} value={row.role} placeholder="예: 시나리오" onChange={event=>change(index,"role",event.target.value)}/></label><label>이름·표기문<textarea aria-label={`제작진 ${index+1} 이름`} maxLength={4000} rows={3} value={row.names} placeholder="여러 명은 줄을 바꿔 입력하세요" onChange={event=>change(index,"names",event.target.value)}/></label><div className="team-credit-actions"><button className="studio-button" aria-label={`제작진 ${index+1} 위로`} disabled={index===0} onClick={()=>move(index,-1)}>위로</button><button className="studio-button" aria-label={`제작진 ${index+1} 아래로`} disabled={index===rows.length-1} onClick={()=>move(index,1)}>아래로</button><button className="studio-button" aria-label={`제작진 ${index+1} 삭제`} onClick={()=>onEdit({...script,credits:rows.filter((_,i)=>i!==index)})}>삭제</button></div></article>)}
  </section>;
}
