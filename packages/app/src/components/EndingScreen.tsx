interface Props {
  readonly title: string;
  readonly affection?: number;
  readonly routeFlags?: string | null;
  readonly onBack: () => void;
}

export function EndingScreen({ title, routeFlags, onBack }: Props) {
  return (
    <section className="ending-screen" data-testid="ending-screen">
      <div className="ending-plate">
        <p className="ending-eyebrow">ENDING</p>
        <h2 className="ending-title" data-testid="ending-title">
          {title}
        </h2>
        <div className="title-rule" />
        {routeFlags != null && routeFlags !== "" && (
          <p className="ending-flags" data-testid="route-flags">
            {routeFlags}
          </p>
        )}
        <button type="button" className="ink-button" data-testid="back-to-title" onClick={onBack}>
          타이틀로
        </button>
      </div>
    </section>
  );
}
