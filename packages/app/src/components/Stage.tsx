import type { SpriteDirection } from "@vnmaker/content";

interface Props {
  readonly background: string;
  readonly sprites: readonly SpriteDirection[];
  readonly speaking: string | null;
  readonly chapter: string | null;
  readonly sceneEpoch: number;
  readonly transition: string;
}

const slotOrder = ["left", "center", "right"] as const;

export function Stage({ background, sprites, speaking, chapter, sceneEpoch, transition }: Props) {
  return (
    <div className={`stage-layers transition-${transition}`} key={sceneEpoch}>
      <img className="bg-image" data-testid="bg-image" src={`/assets/bg/${background}.png`} alt="" />
      <div className="bg-wash" />
      {slotOrder.map((slot) => {
        const dir = sprites.find((s) => s.slot === slot);
        if (!dir || dir.character === null) return null;
        const expression = dir.expression ?? "neutral";
        const active = speaking === dir.character;
        return (
          <div key={slot} className={`sprite sprite--${slot} ${active ? "is-active" : "is-dim"}`}>
            <div className="sprite-card" />
            <img
              className="sprite-image"
              data-testid={`sprite-${slot}`}
              src={`/assets/sprite/${dir.character}-${expression}.png`}
              alt=""
            />
          </div>
        );
      })}
      {chapter !== null && (
        <div className="chapter-label" data-testid="chapter-label">
          <span>{chapter}</span>
        </div>
      )}
    </div>
  );
}
