interface Props {
  readonly auto: boolean;
  readonly onSave: () => void;
  readonly onLoad: () => void;
  readonly canLoad: boolean;
  readonly onAuto: () => void;
  readonly onSkip: () => void;
  readonly onHistory: () => void;
  readonly onSettings: () => void;
}

export function Toolbar({ auto, onSave, onLoad, canLoad, onAuto, onSkip, onHistory, onSettings }: Props) {
  return (
    <div className="toolbar" onClick={(e) => e.stopPropagation()}>
      <button type="button" data-testid="save-button" onClick={onSave}>저장</button>
      <button type="button" data-testid="load-button" onClick={onLoad} disabled={!canLoad}>불러오기</button>
      <button type="button" data-testid="auto-button" className={auto ? "is-on" : ""} onClick={onAuto}>오토</button>
      <button type="button" data-testid="skip-button" onClick={onSkip}>스킵</button>
      <button type="button" data-testid="history-button" onClick={onHistory}>기록</button>
      <button type="button" data-testid="settings-button" onClick={onSettings}>설정</button>
    </div>
  );
}
