import type { Choice, Scene, VnScript } from "@vnmaker/content";
import { scriptSchema } from "@vnmaker/harness";
import { artUrl, audioUrl } from "./media.js";

const sceneId = (number: number): string => `s${String(number).padStart(3, "0")}`;

function exitFor(number: number): Pick<Scene, "choices" | "next" | "ending"> {
  if (number >= 78) return { ending: `ending-${number - 78}` };
  if (number === 77) return { choices: [
    { id: "finish-0", text: "Synthetic exit 0", next: "s078", when: { compare: [{ flag: "score", op: "lte", value: 2 }] } },
    { id: "finish-1", text: "Synthetic exit 1", next: "s079", when: { compare: [{ flag: "score", op: "gte", value: 3 }, { flag: "score", op: "lte", value: 5 }] } },
    { id: "finish-2", text: "Synthetic exit 2", next: "s080", when: { compare: [{ flag: "score", op: "gte", value: 6 }] } },
  ] };
  const branch = [{ scene: 20, flag: "a", weight: 1 }, { scene: 40, flag: "b", weight: 2 }, { scene: 60, flag: "c", weight: 4 }].find(row => row.scene === number);
  if (branch) return { choices: [0, 1].map((bit): Choice => ({
    id: `${branch.flag}-${bit}`, text: `Synthetic ${branch.flag} ${bit}`, next: sceneId(number + 1),
    set: { [branch.flag]: bit === 1 }, add: { score: bit * branch.weight },
  })) };
  return { next: sceneId(number + 1) };
}

/** Synthetic load fixture only: padded text and geometric media are not a novel. */
export function generateMedium(): VnScript {
  return scriptSchema.parse({
    title: "SYNTHETIC medium harness fixture", subtitle: "Not AI-generated; not for release",
    start: "s001", flags: { a: false, b: false, c: false, score: 0 },
    characters: Array.from({ length: 8 }, (_, index) => ({
      id: `actor-${index}`, name: `Synthetic actor ${index}`, color: "#4488cc", bio: "Synthetic test identity",
      expressionImages: Object.fromEntries(Array.from({ length: 5 }, (_, expression) => [`e${expression}`, artUrl(80 + index * 5 + expression)])),
    })),
    scenes: Array.from({ length: 80 }, (_, index): Scene => ({
      id: sceneId(index + 1), chapter: `Synthetic chapter ${Math.floor(index / 10) + 1}`,
      background: "title", backgroundUrl: artUrl(index), bgm: audioUrl(index % 20),
      lines: Array.from({ length: 75 }, (_, line) => ({
        id: `l${String(line + 1).padStart(3, "0")}`, speaker: `actor-${line % 8}`, expression: `e${line % 5}`,
        text: `Synthetic fixture ${sceneId(index + 1)} line ${line + 1}. No authored narrative or provider output.`,
        ...(index === 40 && line === 73 ? { when: { none: ["a"] } } : {}),
        ...(index === 40 && line === 74 ? { when: { all: ["a"] } } : {}),
      })),
      ...exitFor(index + 1),
    })),
    assets: Array.from({ length: 120 }, (_, index) => ({
      id: `synthetic-art-${index}`, name: `Synthetic geometry ${index}`, url: artUrl(index),
      ...(index < 80 ? { kind: "background", sceneId: sceneId(index + 1), compositing: "opaque" }
        : { kind: "character", characterId: `actor-${Math.floor((index - 80) / 5)}`, expression: `e${(index - 80) % 5}`, compositing: "alpha" }),
      provenance: { creator: "Deterministic fixture generator", source: "synthetic", license: "CC0-1.0" },
    })),
    audioAssets: Array.from({ length: 20 }, (_, index) => ({
      id: `synthetic-audio-${index}`, name: `Synthetic PCM ${index}`, kind: "bgm", url: audioUrl(index), duration: 0.001,
      provenance: { creator: "Deterministic fixture generator", source: "synthetic", license: "CC0-1.0" },
    })),
  });
}
