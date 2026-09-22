import { useEffect, useRef } from "react";
import { openModal } from "./modal.js";
import type { VnScript } from "@vnmaker/content";
import "../styles/credits.css";

export function CreditsPanel({script, standalone, onClose}: {script: VnScript; standalone: boolean; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    openModal(node);
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const records = [...(script.assets ?? []), ...(script.audioAssets ?? [])].filter(asset => {
    const p = asset.provenance;
    return p?.credit?.trim() || p?.creator?.trim() || p?.license?.trim();
  });
  return <dialog ref={dialog} className="player-credits" aria-labelledby="player-credits-title" data-testid="credits-panel" onCancel={event => {event.preventDefault(); onClose();}} onClick={event => event.stopPropagation()}>
    <header><div><p>CREDITS</p><h2 id="player-credits-title">{script.title}</h2></div><button type="button" onClick={onClose} autoFocus>닫기</button></header>
    <div className="player-credits-scroll">
      {script.credits?.some(credit => credit.names.trim()) && <section className="team-credits"><h3>제작진</h3>{script.credits.filter(credit=>credit.names.trim()).map((credit,index)=><article key={index}><h4>{credit.role.trim() || "참여"}</h4><p>{credit.names}</p></article>)}</section>}
      <h3>아트 · 사운드</h3>
      {records.length ? records.map((asset, index) => <article key={`${asset.id}:${index}`}><h4>{asset.name}</h4>{asset.provenance?.credit && <p>{asset.provenance.credit}</p>}<dl>{asset.provenance?.creator && <><dt>제작자</dt><dd>{asset.provenance.creator}</dd></>}{asset.provenance?.license && <><dt>이용 조건</dt><dd>{asset.provenance.license}</dd></>}</dl></article>) : <p>등록된 소재 크레딧이 없습니다.</p>}
      <section><h3>게임 제작 도구</h3><p>Made with VN Maker</p>{standalone && <p><a href="./THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener noreferrer">소프트웨어 라이선스 · 새 탭</a></p>}</section>
    </div>
  </dialog>;
}
