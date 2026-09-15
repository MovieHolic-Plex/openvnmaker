import { useRef, useState } from "react";
import type { Artwork, VnScript } from "@vnmaker/content";
import { importImages } from "../storage/projectAssets.js";
import { dedupeImportedArtwork } from "./assets.js";
import { Icon } from "./Icon.js";

export function ArtImportButton({script,onImport}:{script:VnScript;onImport:(assets:Artwork[])=>void}){
  const [kind,setKind]=useState<Artwork["kind"]>("background");
  const [character,setCharacter]=useState("");
  const [expression,setExpression]=useState("neutral");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const input=useRef<HTMLInputElement>(null),latest=useRef(script);latest.current=script;
  async function importFiles(files:FileList|null){
    if(!files?.length)return;
    const before=script;setBusy(true);setError("");setNotice("");
    try{
      if(kind==="character" && !script.characters.some(actor=>actor.id===character))throw new Error("원화를 사용할 캐릭터를 먼저 선택하세요.");
      if(kind==="character" && expression && !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(expression))throw new Error("표정 ID는 영문자로 시작하는 영문·숫자·하이픈·밑줄을 사용하세요.");
      const rows=await importImages(Array.from(files));
      if(latest.current!==before)throw new Error("가져오는 동안 원고가 변경됐습니다. 원화 파일은 보관했으며 현재 작품에는 적용하지 않았습니다. 다시 가져와 등록하세요.");
      const {fresh,skipped}=dedupeImportedArtwork(before,rows,kind,kind==="character"?character:undefined,kind==="character"?expression||undefined:undefined);
      if(skipped)setNotice(`이미 라이브러리에 있는 원화 ${skipped}개는 다시 등록하지 않았습니다.`);
      if(fresh.length)onImport(fresh.map(row=>({id:`user-${crypto.randomUUID()}`,name:row.originalName.replace(/\.[^.]+$/,""),kind,url:row.path,createdAt:new Date(row.createdAt).toISOString(),...(kind==="character"?{characterId:character,...(expression?{expression}:{})}:{})})));
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);if(input.current)input.current.value="";}
  }
  return <section className="art-import"><div className="art-section-title"><Icon name="upload"/><h2>내 원화 가져오기</h2></div>
    <label>이미지 종류<select aria-label="가져올 원화 종류" value={kind} disabled={busy} onChange={event=>setKind(event.target.value as Artwork["kind"])}><option value="background">배경</option><option value="cg">이벤트 CG</option><option value="character">캐릭터</option></select></label>
    {kind==="character"&&<><label>캐릭터<select aria-label="가져올 원화 캐릭터" value={character} disabled={busy} onChange={event=>setCharacter(event.target.value)}><option value="">캐릭터 선택</option>{script.characters.map(actor=><option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label><label>표정 ID<input aria-label="가져올 원화 표정" value={expression} disabled={busy} onChange={event=>setExpression(event.target.value)} placeholder="neutral · 빈 값은 별도 포즈"/></label></>}
    <input ref={input} data-testid="art-import-files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event=>void importFiles(event.target.files)}/>
    <button type="button" className="art-primary" disabled={busy} onClick={()=>input.current?.click()}><Icon name="upload"/>{busy?"원화 보관 중…":"이미지 파일 선택"}</button>
    <p>PNG·JPEG·WebP를 원본 그대로 이 브라우저에 보관합니다. 투명 PNG도 지원합니다. 게임 ZIP에는 실제 파일이 함께 들어갑니다.</p>{error&&<p role="alert" className="art-error">{error}</p>}{notice&&<p role="status" className="art-message" data-testid="art-import-notice">{notice}</p>}
  </section>;
}
