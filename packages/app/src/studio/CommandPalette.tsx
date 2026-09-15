import { useEffect, useMemo, useRef, useState } from "react";
import type { VnScript } from "@vnmaker/content";
import { Icon } from "./Icon.js";
import { backgroundSrc, sceneTitle } from "./project.js";
import { replaceAll, replaceInMatch, type TextMatch } from "./findReplace.js";

interface Props {
  script: VnScript;
  onClose: () => void;
  onSelect: (id: string, line: number) => void;
  /** 찾아 바꾸기 결과 원고. 한 번의 호출이 실행 취소 한 단계다. */
  onReplace?: (script: VnScript, replaced: number) => void;
}
interface Row { scene: VnScript["scenes"][number]; line: number; key: string; label: string; excerpt: string; match?: TextMatch }

export function CommandPalette({ script, onClose, onSelect, onReplace }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [limit, setLimit] = useState(40);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replaced, setReplaced] = useState<number | null>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); input.current?.focus(); return () => node?.close(); }, []);
  const normalized = query.trim().toLocaleLowerCase();
  const rawQuery = query.trim();
  const results = useMemo(() => {
    const names = new Map(script.characters.map(actor => [actor.id, actor.name]));
    return script.scenes.flatMap(scene => {
      const rows: Row[] = [];
      if (!replaceMode && (!normalized || `${scene.id} ${scene.chapter ?? ""} ${scene.ending ?? ""}`.toLocaleLowerCase().includes(normalized))) {
        rows.push({ scene, line: 0, key: `${scene.id}:scene`, label: "장면 시작", excerpt: `${scene.id} · ${scene.lines.length}줄${scene.ending ? ` · ${scene.ending}` : ""}` });
      }
      if (normalized) {
        scene.lines.forEach((line, index) => {
          const speaker = line.speaker ? names.get(line.speaker) ?? line.speaker : "내레이션";
          const inText = line.text.toLocaleLowerCase().includes(normalized);
          if (inText || (!replaceMode && `${speaker} ${line.speaker ?? ""}`.toLocaleLowerCase().includes(normalized))) {
            rows.push({ scene, line: index, key: `${scene.id}:${index}`, label: `${index + 1}줄 · ${speaker}`, excerpt: line.text, ...(inText ? { match: { sceneId: scene.id, kind: "line", index, text: line.text, count: 0 } } : {}) });
          }
        });
        scene.choices?.forEach((choice, index) => {
          if (choice.text.toLocaleLowerCase().includes(normalized)) rows.push({ scene, line: Math.max(0, scene.lines.length - 1), key: `${scene.id}:choice:${index}`, label: `선택지 ${index + 1}`, excerpt: choice.text, match: { sceneId: scene.id, kind: "choice", index, text: choice.text, count: 0 } });
        });
      }
      return rows;
    });
  }, [script, normalized, replaceMode]);
  const replaceable = results.filter(row => row.match).length;
  useEffect(() => { dialog.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" }); }, [selected, limit]);
  useEffect(() => { setReplaced(null); }, [query, replaceMode]);
  function choose(index: number) { const row = results[index]; if (row) onSelect(row.scene.id, row.line); }
  function replaceSelected() {
    const row = results[selected];
    if (!row?.match || !rawQuery || !onReplace) return;
    onReplace(replaceInMatch(script, row.match, rawQuery, replacement), row.match.count || 1);
    setReplaced(value => (value ?? 0) + 1);
  }
  function replaceEverything() {
    if (!rawQuery || !onReplace) return;
    const result = replaceAll(script, rawQuery, replacement);
    if (result.replaced) onReplace(result.script, result.replaced);
    setReplaced(result.replaced);
  }
  return <dialog ref={dialog} className="command-palette" aria-label="장면과 대사 빠르게 찾기" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.target !== input.current) return;
    if (event.key === "ArrowDown") { event.preventDefault(); const next = Math.min(Math.max(0, results.length - 1), selected + 1); setSelected(next); setLimit(value => Math.max(value, next + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); }
    if (event.key === "Enter") { event.preventDefault(); choose(selected); }
  }}>
    <div className="command-search"><Icon name="search" size={21} /><input ref={input} aria-label="장면 또는 대사 검색" placeholder={replaceMode ? "바꿀 대사나 선택지 문구 검색…" : "장면, 대사, 화자 이름이나 ID 검색…"} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); setLimit(40); }} />{onReplace && <button type="button" className={`text-button palette-mode ${replaceMode ? "is-active" : ""}`} aria-pressed={replaceMode} data-testid="palette-replace-toggle" onClick={() => { setReplaceMode(!replaceMode); setSelected(0); }}>바꾸기</button>}<button className="icon-button" aria-label="빠른 찾기 닫기" onClick={onClose}><Icon name="close" /></button></div>
    {replaceMode && onReplace && <div className="command-replace"><input aria-label="바꿀 내용" placeholder="바꿀 내용" value={replacement} onChange={event => setReplacement(event.target.value)} /><button type="button" className="studio-button" data-testid="palette-replace-one" disabled={!rawQuery || !results[selected]?.match} onClick={replaceSelected}>이 항목 바꾸기</button><button type="button" className="studio-button primary" data-testid="palette-replace-all" disabled={!rawQuery || !replaceable} onClick={replaceEverything}>모두 바꾸기{replaceable ? ` (${replaceable})` : ""}</button></div>}
    <p className="command-caption" role="status">{replaced !== null ? `${replaced}곳을 바꿨습니다. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.` : normalized ? `검색 결과 ${results.length}개` : replaceMode ? "대사와 선택지 문구에서 검색어를 찾아 바꿉니다" : `원고 순서 · ${results.length}개 장면`}<span>↑ ↓ 이동 · Enter 열기 · Esc 닫기</span></p>
    <div className="command-results">{results.slice(0, limit).map((row, index) => <button key={row.key} className={index === selected ? "is-selected" : ""} onClick={() => { if (replaceMode) setSelected(index); else choose(index); }} onDoubleClick={() => choose(index)}><img src={backgroundSrc(row.scene)} alt="" loading="lazy" /><span><strong>{sceneTitle(row.scene)} · {row.label}</strong><small>{row.excerpt}</small></span><Icon name="arrow" size={15} /></button>)}{!results.length && <p className="command-empty">{replaceMode ? "일치하는 대사나 선택지 문구가 없습니다." : "일치하는 장면, 대사 또는 화자가 없습니다."}</p>}{results.length > limit && <button onClick={() => setLimit(value => value + 40)}>결과 더 보기 · {results.length - limit}개 남음</button>}</div>
  </dialog>;
}
