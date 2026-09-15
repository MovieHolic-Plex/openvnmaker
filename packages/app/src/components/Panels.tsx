import type {VnScript} from "@vnmaker/content";
import {assetUrl} from "../assetUrl.js";
import {manuscriptKey} from "../storage/manuscriptKey.js";
import { useEffect, useMemo, useRef } from "react";
import type { HistoryEntry } from "../engine/types.js";
import type { Settings } from "../storage/persist.js";
import { formatSlotDate, type GalleryUnlocks, type SlotSave } from "../storage/persist.js";

export type BacklogEntry = HistoryEntry;

interface HistoryProps {
  readonly entries: readonly BacklogEntry[];
  readonly nameOf: (speaker: string | null) => string | null;
  readonly colorOf: (speaker: string | null) => string;
  readonly onClose: () => void;
}

export function HistoryPanel({ entries, nameOf, colorOf, onClose }: HistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    closeButton.current?.focus();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  // 백로그를 열면 맨 아래(최신 대사)로 스크롤한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  let seenChapter: string | null = null;
  return (
    <dialog ref={dialog} className="backlog" aria-label="대사 기록" data-testid="history-panel" onCancel={event => {event.preventDefault(); onClose();}} onClick={(e) => e.stopPropagation()} onKeyDown={event => {
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === closeButton.current) {event.preventDefault(); scrollRef.current?.focus();}
      else if (!event.shiftKey && document.activeElement === scrollRef.current) {event.preventDefault(); closeButton.current?.focus();}
    }}>
      <header className="backlog-head">
        <div><p>STORY LOG</p><h3>대사 기록 <span>{entries.length}개</span></h3></div>
        <button
          ref={closeButton}
          type="button"
          data-testid="backlog-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          닫기
        </button>
      </header>
      <div className="backlog-scroll" ref={scrollRef} role="region" aria-label="읽은 대사" tabIndex={0} onKeyDown={event => {
        if (event.key === "Home" || event.key === "End") {event.preventDefault(); event.currentTarget.scrollTop = event.key === "Home" ? 0 : event.currentTarget.scrollHeight;}
      }}>
        {entries.length === 0 && <p className="panel-empty">아직 기록이 없다.</p>}
        {entries.map((entry, index) => {
          const name = nameOf(entry.speaker);
          const chapter = entry.chapter ?? null;
          const showChapter = chapter !== null && chapter !== seenChapter;
          seenChapter = chapter;
          return (
            <div
              key={`backlog-${index}-${entry.speaker ?? "narration"}-${entry.text.length}-${entry.text.slice(0, 12)}`}
            >
              {showChapter && chapter !== null && (
                <p className="backlog-chapter" data-testid="backlog-chapter">
                  {chapter}
                </p>
              )}
              <p className="backlog-line">
                {name !== null && (
                  <strong className="backlog-speaker" style={{ color: colorOf(entry.speaker) }}>
                    {name}
                  </strong>
                )}
                <span>{entry.text}</span>
              </p>
            </div>
          );
        })}
      </div>
    </dialog>
  );
}

export type SlotPickerMode = "save" | "load";

interface SlotPickerProps {
  readonly currentScript?: VnScript;
  readonly mode: SlotPickerMode;
  readonly slots: readonly (SlotSave | null)[];
  readonly autoSlot: SlotSave | null;
  readonly quickSlot?: SlotSave | null | undefined;
  readonly onPick: (index: number) => void;
  readonly onPickAuto: () => void;
  readonly onPickQuick?: (() => void) | undefined;
  readonly onClose: () => void;
  readonly error?: string | null;
}

function slotSummary(slot: SlotSave): string {
  const head = slot.chapter ?? slot.sceneId;
  const tail = slot.preview === "" ? "기록 없음" : slot.preview;
  return `${head} · ${formatSlotDate(slot.savedAt)} · ${tail}`;
}

export function SlotPicker({ mode, slots, autoSlot, quickSlot = null, onPick, onPickAuto, onPickQuick, onClose, error, currentScript }: SlotPickerProps) {
  // 원고 비교 키는 원고 전체를 직렬화한다 — 타이프라이터가 프레임마다 다시 그려도 슬롯 목록이 바뀌지 않았으면 다시 계산하지 않는다.
  const currentKey=useMemo(()=>currentScript?manuscriptKey(currentScript):null,[currentScript]);
  const notes=useMemo(()=>{
    const keyOf=new Map<VnScript,string>();
    const note=(slot:SlotSave|null)=>{
      if(!slot||!currentKey)return null;
      if(!slot.script)return "원고가 포함되지 않은 이전 저장";
      let key=keyOf.get(slot.script);if(key===undefined){key=manuscriptKey(slot.script);keyOf.set(slot.script,key);}
      return key!==currentKey?"현재 재생 원고와 다른 저장본 · 저장 당시 원고로 이어집니다":null;
    };
    return {slots:slots.map(note),auto:note(autoSlot),quick:note(quickSlot)};
  },[slots,autoSlot,quickSlot,currentKey]);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();const node=dialog.current;return()=>node?.close();},[]);
  return (
    <dialog ref={dialog} className="slot-picker" data-testid="slot-picker" aria-label={mode === "save" ? "플레이 저장" : "저장 불러오기"} onCancel={event=>{event.preventDefault();onClose();}} onClick={(e) => e.stopPropagation()}>
      <header className="slot-picker-head">
        <h3>{mode === "save" ? "어디에 저장할까" : "어디서 이어할까"}</h3>
        <button type="button" onClick={onClose}>닫기</button>
      </header>
      <p className="slot-help">작품 원고·읽던 위치·선택 기록을 함께 보관합니다. 자동 저장은 수동 슬롯을 덮어쓰지 않습니다. 원고가 다른 저장본은 최신 수정 내용을 합치지 않고 저장 당시 원고로 재생합니다. 이미지·음원 파일 자체는 세이브에 포함되지 않습니다.</p>
      {error && <p className="slot-error" role="alert">{error}</p>}
      <ul className="slot-picker-list">
        {slots.map((slot, index) => (
          <li key={`slot-${index}`} className="slot-row" data-testid={`slot-row-${index}`}>
            {slot?.thumbnail ? <img src={assetUrl(slot.thumbnail)} alt="" /> : <div className="slot-placeholder">{String(index+1).padStart(2,"0")}</div>}
            <span className="slot-name">슬롯 {index + 1}</span>
            <span className="slot-summary">{slot === null ? "비어 있음" : slotSummary(slot)}</span>{notes.slots[index]&&<small className="slot-version-note">{notes.slots[index]}</small>}
            {mode === "save" ? (
              <button type="button" data-testid={`slot-save-${index}`} onClick={() => onPick(index)}>
                {slot === null ? "저장" : "덮어쓰기"}
              </button>
            ) : (
              <button
                type="button"
                data-testid={`slot-load-${index}`}
                disabled={slot === null}
                onClick={() => onPick(index)}
              >
                불러오기
              </button>
            )}
          </li>
        ))}
        {mode === "load" && (
          <li className="slot-row" data-testid="slot-row-auto">
            {autoSlot?.thumbnail && <img src={assetUrl(autoSlot.thumbnail)} alt="" />}
            <span className="slot-name">자동 저장</span>
            <span className="slot-summary">{autoSlot === null ? "비어 있음" : slotSummary(autoSlot)}</span>{notes.auto&&<small className="slot-version-note">{notes.auto}</small>}
            <button
              type="button"
              data-testid="slot-load-auto"
              disabled={autoSlot === null}
              onClick={onPickAuto}
            >
              불러오기
            </button>
          </li>
        )}
        {mode === "load" && onPickQuick && quickSlot && (
          <li className="slot-row" data-testid="slot-row-quick">
            {quickSlot.thumbnail && <img src={assetUrl(quickSlot.thumbnail)} alt="" />}
            <span className="slot-name">퀵 세이브 <small>F5 / F9</small></span>
            <span className="slot-summary">{slotSummary(quickSlot)}</span>{notes.quick&&<small className="slot-version-note">{notes.quick}</small>}
            <button type="button" data-testid="slot-load-quick" onClick={onPickQuick}>불러오기</button>
          </li>
        )}
      </ul>
    </dialog>
  );
}

/** 작품에 존재하는 전체 이벤트 CG 주소 풀 — 해금률의 분모. */
function collectCgPool(script: VnScript): string[] {
  const pool = new Set<string>();
  for (const asset of script.assets ?? []) if (asset.kind === "cg") pool.add(asset.url);
  for (const scene of script.scenes) {
    if (scene.cgUrl) pool.add(scene.cgUrl);
    if (scene.cg) {
      const asset = script.assets?.find((row) => row.id === scene.cg);
      if (asset) pool.add(asset.url);
    }
    for (const line of scene.lines) if (typeof line.cgUrl === "string") pool.add(line.cgUrl);
  }
  return [...pool];
}

interface GalleryProps {
  readonly script: VnScript;
  readonly gallery: GalleryUnlocks;
  readonly onClose: () => void;
}

export function GalleryPanel({ script, gallery, onClose }: GalleryProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); }; }, []);
  const cgs = collectCgPool(script);
  const endings = [...new Set(script.scenes.flatMap((scene) => scene.ending ? [scene.ending] : []))];
  return (
    <dialog ref={dialog} className="gallery-dialog" aria-label="갤러리" data-testid="gallery-panel" onCancel={event => { event.preventDefault(); onClose(); }} onClick={(e) => e.stopPropagation()}>
      <header className="backlog-head">
        <div><p>ARCHIVE</p><h3>갤러리 <span>CG {gallery.cgs.length}/{cgs.length} · 결말 {gallery.endings.length}/{endings.length}</span></h3></div>
        <button type="button" data-testid="gallery-close" onClick={onClose}>닫기</button>
      </header>
      <div className="gallery-scroll">
        <h4 className="gallery-section">이벤트 CG</h4>
        {cgs.length === 0 && <p className="panel-empty">이 작품에는 이벤트 CG가 없다.</p>}
        <ul className="gallery-grid">
          {cgs.map((url, index) => {
            const unlocked = gallery.cgs.includes(url);
            return <li key={url} className={unlocked ? "" : "is-locked"}>{unlocked ? <img src={assetUrl(url)} alt={`이벤트 CG ${index + 1}`} /> : <span>?</span>}</li>;
          })}
        </ul>
        <h4 className="gallery-section">결말</h4>
        <ul className="gallery-endings">
          {endings.map((ending) => <li key={ending} className={gallery.endings.includes(ending) ? "" : "is-locked"}>{gallery.endings.includes(ending) ? ending : "???"}</li>)}
        </ul>
      </div>
    </dialog>
  );
}

interface SettingsProps {
  readonly onCredits: () => void;
  readonly settings: Settings;
  readonly onChange: (next: Settings) => void;
  readonly onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose, onCredits }: SettingsProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    closeButton.current?.focus();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return (
    <dialog ref={dialog} className="panel settings-dialog" aria-label="플레이 설정" data-testid="settings-panel" onCancel={event => {event.preventDefault(); onClose();}} onClick={(e) => e.stopPropagation()} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header>
        <h3>설정</h3><button type="button" data-testid="credits-button" onClick={onCredits}>크레딧</button>
        <button ref={closeButton} type="button" onClick={onClose}>닫기</button>
      </header>
      <label>
        BGM 음량 <output>{Math.round(settings.bgmVolume * 100)}</output>
        <input
          type="range" min="0" max="1" step="0.05" value={settings.bgmVolume}
          data-testid="bgm-volume"
          onChange={(e) => onChange({ ...settings, bgmVolume: Number(e.target.value) })}
        />
      </label>
      <label>
        효과음 음량 <output>{Math.round(settings.sfxVolume * 100)}</output>
        <input
          type="range" min="0" max="1" step="0.05" value={settings.sfxVolume}
          data-testid="sfx-volume"
          onChange={(e) => onChange({ ...settings, sfxVolume: Number(e.target.value) })}
        />
      </label>
      <label>
        보이스 음량 <output>{Math.round((settings.voiceVolume??0.8)*100)}</output>
        <input type="range" min="0" max="1" step="0.05" value={settings.voiceVolume??0.8} data-testid="voice-volume" onChange={e=>onChange({...settings,voiceVolume:Number(e.target.value)})}/>
      </label>
      <label>
        글자 속도 <output>{settings.textSpeed}ms</output>
        <input
          type="range" min="5" max="90" step="1" value={settings.textSpeed}
          data-testid="text-speed"
          onChange={(e) => onChange({ ...settings, textSpeed: Number(e.target.value) })}
        />
      </label>
      <label>
        오토 속도 <output>{settings.autoSpeed ?? 45}ms</output>
        <input
          type="range" min="10" max="150" step="5" value={settings.autoSpeed ?? 45}
          data-testid="auto-speed"
          aria-description="글자당 대기 시간. 낮을수록 빨리 넘어갑니다."
          onChange={(e) => onChange({ ...settings, autoSpeed: Number(e.target.value) })}
        />
      </label>
      <label className="settings-toggle">
        <span>음소거</span>
        <input type="checkbox" data-testid="mute-toggle" checked={settings.muted === true} onChange={(e) => onChange({ ...settings, muted: e.target.checked })} />
        <small>음량 값은 유지되고 소리만 끕니다.</small>
      </label>
      <label className="settings-toggle">
        <span>읽지 않은 대사도 스킵</span>
        <input type="checkbox" data-testid="skip-unread-toggle" checked={settings.skipUnread === true} onChange={(e) => onChange({ ...settings, skipUnread: e.target.checked })} />
        <small>기본은 이미 읽은 대사만 건너뜁니다.</small>
      </label>
    </dialog>
  );
}
