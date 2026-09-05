import { validBackgroundUrl, type Character, type SpriteDirection } from "@vnmaker/content";
import "./art-stage.css";
import { ArtImage } from "./ArtImage.js";

interface Props {
  readonly background: string;
  readonly backgroundUrl?: string | undefined;
  readonly cgUrl?: string | undefined;
  readonly hideSprites?: boolean | undefined;
  readonly framing?: "wide" | "close" | "cinematic" | undefined;
  readonly characters?: readonly Character[] | undefined;
  readonly sprites: readonly SpriteDirection[];
  readonly speaking: string | null;
  readonly chapter: string | null;
  readonly sceneEpoch: number;
  readonly transition: string;
}

const slotOrder = ["left", "center", "right"] as const;

export function Stage({ background, backgroundUrl, cgUrl, hideSprites, framing = "wide", characters, sprites, speaking, chapter, sceneEpoch, transition }: Props) {
  const eventArt = validBackgroundUrl(cgUrl) ? cgUrl : null;
  return (
    <div className={`stage-layers transition-${transition} framing-${eventArt ? "cinematic" : framing} ${eventArt ? "has-event-cg" : ""}`} key={sceneEpoch}>
      <img className="bg-image" data-testid="bg-image" src={eventArt ?? (validBackgroundUrl(backgroundUrl) ? backgroundUrl : `/assets/bg/${background}.png`)} alt="" />
      <div className="bg-wash" />
      {!hideSprites && !eventArt && slotOrder.map((slot) => {
        const dir = sprites.find((s) => s.slot === slot);
        if (!dir || dir.character === null) return null;
        const expression = dir.expression ?? "neutral";
        const actor = characters?.find(character => character.id === dir.character);
        const customImage = actor?.expressionImages?.[expression];
        const active = speaking === dir.character;
        const dim = speaking !== null && !active;
        return (
          <div key={slot} className={`sprite sprite--${slot} ${dim ? "is-dim" : "is-active"}`}>
            <ArtImage
              className="sprite-image"
              testId={`sprite-${slot}`}
              chromaKey={customImage ? actor?.chromaKey : undefined}
              src={validBackgroundUrl(customImage) ? customImage : `/assets/sprite/${dir.character}-${expression}.png`}
              alt=""
            />
          </div>
        );
      })}
      {(framing === "cinematic" || eventArt) && <div className="cinematic-bars" aria-hidden="true" />}
      {chapter !== null && (
        <div className="chapter-label" data-testid="chapter-label">
          <span>{chapter}</span>
        </div>
      )}
    </div>
  );
}
