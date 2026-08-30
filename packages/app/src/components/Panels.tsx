import type { HistoryEntry } from "../engine/types.js";
import type { Settings } from "../storage/persist.js";

interface HistoryProps {
  readonly entries: readonly HistoryEntry[];
  readonly nameOf: (speaker: string | null) => string | null;
  readonly onClose: () => void;
}

export function HistoryPanel({ entries, nameOf, onClose }: HistoryProps) {
  return (
    <div className="panel" data-testid="history-panel" onClick={(e) => e.stopPropagation()}>
      <header>
        <h3>지나온 이야기</h3>
        <button type="button" onClick={onClose}>닫기</button>
      </header>
      <div className="panel-scroll">
        {entries.length === 0 && <p className="panel-empty">아직 기록이 없다.</p>}
        {entries.map((entry, i) => {
          const name = nameOf(entry.speaker);
          return (
            <p key={`${i}-${entry.text.slice(0, 8)}`} className="history-line">
              {name !== null && <strong>{name}</strong>}
              {entry.text}
            </p>
          );
        })}
      </div>
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
