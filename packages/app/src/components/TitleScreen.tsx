interface Props {
  readonly title: string;
  readonly subtitle: string;
  readonly hasSave: boolean;
  readonly onStart: () => void;
  readonly onContinue: () => void;
}

export function TitleScreen({ title, subtitle, hasSave, onStart, onContinue }: Props) {
  return (
    <section className="title-screen" data-testid="title-screen">
      <img className="title-bg" src="/assets/bg/title.png" alt="" aria-hidden="true" />
      <div className="title-wash" />
      <div className="title-plate">
        <p className="title-eyebrow">vnmaker presents</p>
        <h1 className="title-main">{title}</h1>
        <p className="title-sub">{subtitle}</p>
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
        </div>
      </div>
    </section>
  );
}
