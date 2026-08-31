import type { AuthStatus } from "../api/gateway.js";

interface Props {
  readonly title: string;
  readonly subtitle: string;
  readonly hasSave: boolean;
  readonly auth: AuthStatus;
  readonly connectBusy: boolean;
  readonly helloBusy: boolean;
  readonly helloError: string | null;
  readonly onConnect: () => void;
  readonly onHello: () => void;
  readonly onStart: () => void;
  readonly onContinue: () => void;
}

function authLabel(auth: AuthStatus, connectBusy: boolean): string {
  if (connectBusy) return "브라우저에서 동의하는 중";
  if (!auth.reachable) return "게이트웨이에 못 붙었다 · 데모는 그대로 된다";
  if (auth.authenticated) return auth.email ? `연결됨 · ${auth.email}` : "연결됨";
  return "미연결 · 비공식 Antigravity 어댑터";
}

export function TitleScreen({
  title,
  subtitle,
  hasSave,
  auth,
  connectBusy,
  helloBusy,
  helloError,
  onConnect,
  onHello,
  onStart,
  onContinue,
}: Props) {
  return (
    <section className="title-screen" data-testid="title-screen">
      <img className="title-bg" data-testid="bg-image" src="/assets/bg/title.png" alt="" aria-hidden="true" />
      <div className="title-wash" />
      <div className="title-plate">
        <p className="title-eyebrow">vnmaker presents</p>
        <h1 className="title-main">{title}</h1>
        <p className="title-sub">{subtitle}</p>
        <p className="title-auth" data-testid="auth-status">
          {authLabel(auth, connectBusy)}
        </p>
        <div className="title-rule" />
        <div className="title-actions">
          <button type="button" className="ink-button" data-testid="start-button" onClick={onStart}>
            처음부터 시작
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
          {!auth.authenticated && (
            <button
              type="button"
              className="ink-button ink-button--ghost"
              data-testid="connect-button"
              disabled={connectBusy || !auth.reachable}
              onClick={onConnect}
            >
              {connectBusy ? "연결 중" : "Google 연결"}
            </button>
          )}
          <button
            type="button"
            className="ink-button"
            data-testid="hello-button"
            disabled={helloBusy || !auth.authenticated}
            onClick={onHello}
          >
            {helloBusy ? "쓰는 중" : "한 줄 받기"}
          </button>
        </div>
        {helloError !== null && (
          <p className="title-error" data-testid="hello-error">
            {helloError}
          </p>
        )}
      </div>
    </section>
  );
}
