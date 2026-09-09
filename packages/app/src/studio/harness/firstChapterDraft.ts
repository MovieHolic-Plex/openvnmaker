import { parseScript, type VnScript } from "@vnmaker/content";
import { parseProductionDocument, type ProductionDocument } from "@vnmaker/harness";

function beat(id: string, extra: Record<string, unknown>) {
  return {
    id, chapter: "1", title: id, summary: "first-chapter", artDirection: "geometry",
    targetMinutes: 1, background: "title", ...extra,
  };
}

export function firstChapterDraft(title: string): {
  readonly script: VnScript;
  readonly productionDocument: ProductionDocument;
} {
  const script = parseScript({
    title, subtitle: "", start: "ch01-lab", characters: [], flags: { visits: 0 },
    scenes: [
      { id: "ch01-lab", background: "title", chapter: "1", lines: [{ id: "l-a", speaker: null, text: "Lab lights flicker." }], next: "ch01-hall" },
      { id: "ch01-hall", background: "title", chapter: "1", lines: [{ id: "l-b", speaker: null, text: "A door waits at the hall." }], next: "ch01-exit" },
      {
        id: "ch01-exit", background: "title", chapter: "1",
        lines: [{ id: "l-c", speaker: null, text: "The next chapter is not written." }],
        choices: [{ id: "continue", text: "Continue", next: "ch02-arrival", add: { visits: 1 } }],
      },
    ],
  });
  const productionDocument = parseProductionDocument({
    version: 1, brief: "first-chapter", castCanon: [], worldTimeline: [], branchFacts: [],
    outline: {
      title, subtitle: "", bible: "", start: "ch01-lab",
      scenes: [
        beat("ch01-lab", { next: "ch01-hall" }),
        beat("ch01-hall", { next: "ch01-exit" }),
        beat("ch01-exit", { choices: [{ id: "continue", text: "Continue", next: "ch02-arrival", add: { visits: 1 } }] }),
        beat("ch02-arrival", { ending: "planned-end" }),
      ],
    },
    artDirection: [], referenceBindings: [],
  });
  return { script, productionDocument };
}

export function unwrittenNextDraft(title: string): {
  readonly script: VnScript;
  readonly productionDocument: ProductionDocument;
} {
  const { productionDocument } = firstChapterDraft(title);
  const script = parseScript({
    title, subtitle: "", start: "ch01-lab", characters: [],
    scenes: [{ id: "ch01-lab", background: "title", chapter: "1", lines: [{ id: "l-a", speaker: null, text: "Lab lights flicker." }], next: "ch02-arrival" }],
  });
  return { script, productionDocument };
}
