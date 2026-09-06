import { validBackgroundUrl } from "@vnmaker/content";
import { resolveRuntimeAsset } from "../storage/runtimeBase.js";

interface Props {
  readonly title: string;
  readonly affection: number;
  readonly background?: string;
  readonly backgroundUrl?: string | undefined;
  readonly cgUrl?: string | undefined;
  readonly showAffection?: boolean;
  readonly onCredits: () => void;
  readonly onBack: () => void;
}

export function EndingScreen({ title, affection, background = "title", backgroundUrl, cgUrl, showAffection = true, onBack, onCredits }: Props) {
  return (
    <section className="ending-screen" data-testid="ending-screen">
      <img className="ending-bg" src={resolveRuntimeAsset(validBackgroundUrl(cgUrl) ? cgUrl : validBackgroundUrl(backgroundUrl) ? backgroundUrl : `/assets/bg/${background}.png`)} alt="" />
      <div className="ending-wash" />
      <div className="ending-plate">
        <p className="ending-eyebrow">ENDING</p>
        <h2 className="ending-title" data-testid="ending-title">
          {title}
        </h2>
        <div className="title-rule" />
        {showAffection && <p className="ending-note">서린과의 거리 {affection}</p>}
        <button type="button" className="ink-button" data-testid="back-to-title" onClick={onBack}>
          타이틀로
        </button>
        <button type="button" className="ink-button" data-testid="credits-button" onClick={onCredits}>크레딧</button>
      </div>
    </section>
  );
}
