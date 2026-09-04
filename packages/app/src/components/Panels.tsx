import { useEffect, useRef } from "react";
import type { HistoryEntry } from "../engine/types.js";
import type { Settings } from "../storage/persist.js";
import { formatSlotDate, type SlotSave } from "../storage/persist.js";

/** 백로그 한 줄. chapter 는 같은 줄이 어느 장에 속했는지이며, 엔진 기록에는 없고 App 이 이어 붙인다. */
export interface BacklogEntry extends HistoryEntry {
  readonly chapter?: string | null;
}

interface HistoryProps {
  readonly entries: readonly BacklogEntry[];
  readonly nameOf: (speaker: string | null) => string | null;
  readonly colorOf: (speaker: string | null) => string;
  readonly onClose: () => void;
}

export function HistoryPanel({ entries, nameOf, colorOf, onClose }: HistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 백로그를 열면 맨 아래(최신 대사)로 스크롤한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  let seenChapter: string | null = null;
  return (
    // 바깥 클릭으로 닫히지 않는다. 닫기 버튼으로만 닫는다.
    <div className="backlog" data-testid="history-panel" onClick={(e) => e.stopPropagation()}>
      <header className="backlog-head">
        <h3>백로그</h3>
        <button
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
      <div className="backlog-scroll" ref={scrollRef}>
        {entries.length === 0 && <p className="panel-empty">아직 기록이 없다.</p>}
        {entries.map((entry, index) => {
          const name = nameOf(entry.speaker);
          const chapter = entry.chapter ?? null;
          const showChapter = chapter !== null && chapter !== seenChapter;
          if (chapter !== null) seenChapter = chapter;
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
    </div>
  );
}

export type SlotPickerMode = "save" | "load";

interface SlotPickerProps {
  readonly mode: SlotPickerMode;
  readonly slots: readonly (SlotSave | null)[];
  readonly autoSlot: SlotSave | null;
  readonly onPick: (index: number) => void;
  readonly onPickAuto: () => void;
  readonly onClose: () => void;
}

function slotSummary(slot: SlotSave): string {
  const head = slot.chapter ?? slot.sceneId;
  const tail = slot.preview === "" ? "기록 없음" : slot.preview;
  return `${head} · ${formatSlotDate(slot.savedAt)} · ${tail}`;
}

export function SlotPicker({ mode, slots, autoSlot, onPick, onPickAuto, onClose }: SlotPickerProps) {
  return (
    <div className="slot-picker" data-testid="slot-picker" onClick={(e) => e.stopPropagation()}>
      <header className="slot-picker-head">
        <h3>{mode === "save" ? "어디에 저장할까" : "어디서 이어할까"}</h3>
        <button type="button" onClick={onClose}>닫기</button>
      </header>
      <ul className="slot-picker-list">
        {slots.map((slot, index) => (
          <li key={`slot-${index}`} className="slot-row" data-testid={`slot-row-${index}`}>
            <span className="slot-name">슬롯 {index + 1}</span>
            <span className="slot-summary">{slot === null ? "비어 있음" : slotSummary(slot)}</span>
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
            <span className="slot-name">자동 저장</span>
            <span className="slot-summary">{autoSlot === null ? "비어 있음" : slotSummary(autoSlot)}</span>
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
      </ul>
    </div>
  );
}

interface SettingsProps {
  readonly settings: Settings;
  readonly onChange: (next: Settings) => void;
  readonly onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsProps) {
  return (
    <div className="panel" data-testid="settings-panel" onClick={(e) => e.stopPropagation()}>
      <header>
        <h3>설정</h3>
        <button type="button" onClick={onClose}>닫기</button>
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
        글자 속도 <output>{settings.textSpeed}ms</output>
        <input
          type="range" min="5" max="90" step="1" value={settings.textSpeed}
          data-testid="text-speed"
          onChange={(e) => onChange({ ...settings, textSpeed: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
