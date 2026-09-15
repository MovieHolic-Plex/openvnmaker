interface Props {
  readonly auto: boolean;
  readonly canBack: boolean;
  readonly onBack: () => void;
  readonly onSave: () => void;
  readonly onLoad: () => void;
  readonly canLoad: boolean;
  readonly onAuto: () => void;
  readonly onSkip: () => void;
  readonly onHistory: () => void;
  readonly onSettings: () => void;
  readonly onTitle?: (() => void) | undefined;
  readonly muted?: boolean | undefined;
  readonly onMute?: (() => void) | undefined;
  readonly fullscreen?: boolean | undefined;
  /** 전체화면 API 가 없는 환경(iOS Safari 등)에서는 버튼을 숨긴다. */
  readonly onFullscreen?: (() => void) | undefined;
}

export function Toolbar({ auto, canBack, onBack, onSave, onLoad, canLoad, onAuto, onSkip, onHistory, onSettings, onTitle, muted = false, onMute, fullscreen = false, onFullscreen }: Props) {
  return (
    <div className="toolbar" onClick={(e) => e.stopPropagation()}>
      <button type="button" data-testid="back-button" onClick={onBack} disabled={!canBack} title="이전 대사 (PageUp · 휠↑)">이전</button>
      <button type="button" data-testid="save-button" onClick={onSave} title="저장 (F5 퀵 세이브)">저장</button>
      <button type="button" data-testid="load-button" onClick={onLoad} disabled={!canLoad} title="불러오기 (F9 퀵 로드)">불러오기</button>
      <button type="button" data-testid="auto-button" className={auto ? "is-on" : ""} aria-pressed={auto} onClick={onAuto}>오토</button>
      {auto && <span className="auto-badge" data-testid="auto-badge" role="status" aria-live="polite">AUTO</span>}
      <button type="button" data-testid="skip-button" onClick={onSkip} title="읽은 대사 건너뛰기 (Ctrl 길게)">스킵</button>
      <button type="button" data-testid="history-button" onClick={onHistory}>기록</button>
      <button type="button" data-testid="settings-button" onClick={onSettings}>설정</button>
      {onMute && <button type="button" data-testid="mute-button" className={muted ? "is-on" : ""} aria-pressed={muted} onClick={onMute} title={muted ? "소리 켜기" : "소리 끄기"}>{muted ? "소리 꺼짐" : "소리"}</button>}
      {onFullscreen && <button type="button" data-testid="fullscreen-button" aria-pressed={fullscreen} onClick={onFullscreen} title="전체화면 전환">{fullscreen ? "창 모드" : "전체화면"}</button>}
      {onTitle && <button type="button" data-testid="title-button" onClick={onTitle} title="타이틀 화면으로 (진행은 자동 저장됩니다)">타이틀</button>}
    </div>
  );
}
