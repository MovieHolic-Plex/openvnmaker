import { useEffect, useRef, useState } from "react";
import type { VnScript } from "@vnmaker/content";
import { Icon } from "./Icon.js";
import { backgroundSrc, sceneTitle } from "./project.js";

export function CommandPalette({ script, onClose, onSelect }: { script: VnScript; onClose: () => void; onSelect: (id: string, line: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  useEffect(() => { const node = dialog.current; node?.showModal(); input.current?.focus(); return () => node?.close(); }, []);
  const normalized = query.trim().toLocaleLowerCase();
  const results = script.scenes.flatMap(scene => {
    const sceneMatch = `${scene.id} ${scene.chapter ?? ""}`.toLocaleLowerCase().includes(normalized);
    const line = normalized ? scene.lines.findIndex(row => row.text.toLocaleLowerCase().includes(normalized)) : -1;
    return sceneMatch || line >= 0 ? [{ scene, line: sceneMatch ? 0 : line, excerpt: line >= 0 ? scene.lines[line]!.text : `${scene.lines.length}줄 · ${scene.ending ? "엔딩" : "장면"}` }] : [];
  }).slice(0, 12);
  function choose(index: number) { const row = results[index]; if (row) onSelect(row.scene.id, row.line); }
  return <dialog ref={dialog} className="command-palette" aria-label="장면과 대사 빠르게 찾기" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected(value => Math.min(results.length - 1, value + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); }
    if (event.key === "Enter") { event.preventDefault(); choose(selected); }
  }}><div className="command-search"><Icon name="search" size={21} /><input ref={input} aria-label="장면 또는 대사 검색" placeholder="장면 제목, ID, 대사를 검색하세요…" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} /><button className="icon-button" aria-label="빠른 찾기 닫기" onClick={onClose}><Icon name="close" /></button></div><p className="command-caption">{normalized ? "검색 결과" : "최근 작업의 장면"}<span>↑ ↓ 이동 · Enter 열기 · Esc 닫기</span></p><div className="command-results">{results.map((row, index) => <button key={row.scene.id} className={index === selected ? "is-selected" : ""} onClick={() => choose(index)}><img src={backgroundSrc(row.scene)} alt="" /><span><strong>{sceneTitle(row.scene)}</strong><small>{row.excerpt}</small></span><Icon name="arrow" size={15} /></button>)}{!results.length && <p className="command-empty">일치하는 장면이나 대사가 없습니다.</p>}</div></dialog>;
}
