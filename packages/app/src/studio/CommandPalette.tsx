import { useEffect, useMemo, useRef, useState } from "react";
import type { VnScript } from "@vnmaker/content";
import { Icon } from "./Icon.js";
import { backgroundSrc, sceneTitle } from "./project.js";

export function CommandPalette({ script, onClose, onSelect }: { script: VnScript; onClose: () => void; onSelect: (id: string, line: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [limit, setLimit] = useState(40);
  useEffect(() => { const node = dialog.current; node?.showModal(); input.current?.focus(); return () => node?.close(); }, []);
  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    const names = new Map(script.characters.map(actor => [actor.id, actor.name]));
    return script.scenes.flatMap(scene => {
      const rows: { scene: typeof scene; line: number; key: string; label: string; excerpt: string }[] = [];
      if (!normalized || `${scene.id} ${scene.chapter ?? ""} ${scene.ending ?? ""}`.toLocaleLowerCase().includes(normalized)) {
        rows.push({ scene, line: 0, key: `${scene.id}:scene`, label: "장면 시작", excerpt: `${scene.id} · ${scene.lines.length}줄${scene.ending ? ` · ${scene.ending}` : ""}` });
      }
      if (normalized) scene.lines.forEach((line, index) => {
        const speaker = line.speaker ? names.get(line.speaker) ?? line.speaker : "내레이션";
        if (`${line.text} ${speaker} ${line.speaker ?? ""}`.toLocaleLowerCase().includes(normalized)) {
          rows.push({ scene, line: index, key: `${scene.id}:${index}`, label: `${index + 1}줄 · ${speaker}`, excerpt: line.text });
        }
      });
      return rows;
    });
  }, [script, normalized]);
  useEffect(() => { dialog.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" }); }, [selected, limit]);
  function choose(index: number) { const row = results[index]; if (row) onSelect(row.scene.id, row.line); }
  return <dialog ref={dialog} className="command-palette" aria-label="장면과 대사 빠르게 찾기" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.target !== input.current) return;
    if (event.key === "ArrowDown") { event.preventDefault(); const next = Math.min(Math.max(0, results.length - 1), selected + 1); setSelected(next); setLimit(value => Math.max(value, next + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); }
    if (event.key === "Enter") { event.preventDefault(); choose(selected); }
  }}>
    <div className="command-search"><Icon name="search" size={21} /><input ref={input} aria-label="장면 또는 대사 검색" placeholder="장면, 대사, 화자 이름이나 ID 검색…" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); setLimit(40); }} /><button className="icon-button" aria-label="빠른 찾기 닫기" onClick={onClose}><Icon name="close" /></button></div>
    <p className="command-caption" role="status">{normalized ? `검색 결과 ${results.length}개` : `원고 순서 · ${results.length}개 장면`}<span>↑ ↓ 이동 · Enter 열기 · Esc 닫기</span></p>
    <div className="command-results">{results.slice(0, limit).map((row, index) => <button key={row.key} className={index === selected ? "is-selected" : ""} onClick={() => choose(index)}><img src={backgroundSrc(row.scene)} alt="" loading="lazy" /><span><strong>{sceneTitle(row.scene)} · {row.label}</strong><small>{row.excerpt}</small></span><Icon name="arrow" size={15} /></button>)}{!results.length && <p className="command-empty">일치하는 장면, 대사 또는 화자가 없습니다.</p>}{results.length > limit && <button onClick={() => setLimit(value => value + 40)}>결과 더 보기 · {results.length - limit}개 남음</button>}</div>
  </dialog>;
}
