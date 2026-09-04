import type { AuthStatus } from "../api/gateway.js";

interface Props {
  readonly title: string;
  readonly subtitle: string;
  readonly hasSave: boolean;
  /** 이어하기 버튼 아래에 붙는 최신 슬롯 요약 줄. 저장본이 없으면 null. */
  readonly continueSummary: string | null;
  readonly auth: AuthStatus;
  readonly connectBusy: boolean;
  readonly helloError: string | null;
  readonly onConnect: () => void;
  readonly onStart: () => void;
  readonly onContinue: () => void;
}

function authLabel(auth: AuthStatus, connectBusy: boolean): string {
  if (connectBusy) return "브라우저에서 동의하는 중";
  if (!auth.reachable) return "게이트웨이에 못 붙었다 · 데모는 그대로 된다";
  if (auth.authenticated) return auth.email ? `연결됨 · ${auth.email}` : "연결됨";
  return "미연결 · 비공식 Antigravity 어댑터";
}

const CONFIG_REASON = "이번 편에서는 타이틀에서 환경설정을 열지 않는다. 소리와 글자는 게임 안 설정 버튼에서 바꾼다.";
const GALLERY_REASON = "이번 편에는 갤러리가 없다. 엔딩을 본 뒤 타이틀로 돌아온다.";

export function TitleScreen({
  title,
  subtitle,
  hasSave,
  continueSummary,
  auth,
  connectBusy,
  helloError,
  onConnect,
  onStart,
  onContinue,
}: Props) {
  return (
    <section className="title-screen" data-testid="title-screen">
      <img
        className="title-bg title-bg--zoom"
        data-testid="bg-image"
        src="/assets/bg/title.png"
        alt=""
        aria-hidden="true"
      />
      <div className="title-wash" />
      <div className="title-plate">
        <p className="title-eyebrow">vnmaker presents</p>
        <h1 className="title-main">{title}</h1>
        <p className="title-sub">{subtitle}</p>
        <div className="title-rule" />
        <nav className="title-actions" aria-label="시작 메뉴">
          <button type="button" className="ink-button" data-testid="start-button" onClick={onStart}>
            시작하기
          </button>
          <button
            type="button"
            className="ink-button ink-button--ghost"
            data-testid="continue-button"
            disabled={!hasSave}
            onClick={onContinue}
          >
            이어서 하기
          </button>
          <button
            type="button"
            className="ink-button ink-button--ghost"
            data-testid="config-button"
            disabled
            title={CONFIG_REASON}
          >
            환경설정
          </button>
          <button
            type="button"
            className="ink-button ink-button--ghost"
            data-testid="gallery-button"
            disabled
            title={GALLERY_REASON}
          >
            갤러리
          </button>
        </nav>
        {continueSummary !== null && (
          <p className="title-continue-summary" data-testid="continue-summary">
            {continueSummary}
          </p>
        )}
        <p className="title-soon" data-testid="title-soon">
          환경설정·갤러리는 이번 편에서 열지 않는다. 소리와 글자는 게임 안 설정에서 바꾼다.
        </p>
        {helloError !== null && (
          <p className="title-error" data-testid="hello-error">
            {helloError}
          </p>
        )}
      </div>
      <footer className="title-foot">
        <span className="title-auth" data-testid="auth-status">
          {authLabel(auth, connectBusy)}
        </span>
        {!auth.authenticated && (
          <button
            type="button"
            className="title-foot-button"
            data-testid="connect-button"
            disabled={connectBusy || !auth.reachable}
            onClick={onConnect}
          >
            {connectBusy ? "연결 중" : "Google 연결"}
          </button>
        )}
        <a className="title-foot-link" data-testid="studio-link" href="/studio.html">
          만들기
        </a>
      </footer>
    </section>
  );
}
