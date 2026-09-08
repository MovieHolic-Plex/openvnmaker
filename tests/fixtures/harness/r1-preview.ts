import { canonicalHash, parsePreviewSnapshot, productionOutlineSchema, sceneSchema } from "@vnmaker/harness";
import { generateMedium } from "./medium.js";
import { FIXTURE_IDS, fixtureHead } from "./heads.js";

export async function partialChapterFixture() {
  const materializedScenes = ["ch01-lab", "ch01-hall", "ch01-exit"].map((id, index) => sceneSchema.parse({
    id, background: "title", lines: [{ id: "l-a", speaker: null, text: `Synthetic chapter scene ${index}` }],
    ...(index < 2 ? { next: index === 0 ? "ch01-hall" : "ch01-exit" } : {
      choices: [{ id: "continue", text: "Synthetic unwritten edge", next: "ch02-arrival", add: { visits: 1 } }],
    }),
  }));
  const sourceHead = await fixtureHead(generateMedium());
  const outline = productionOutlineSchema.parse({ title: "Synthetic partial chapter", subtitle: "", bible: "", start: "ch01-lab",
    scenes: [...materializedScenes.map(scene => ({ id: scene.id, next: scene.next, choices: scene.choices })), { id: "ch02-arrival", ending: "planned-end" }]
      .map(scene => ({ ...scene, chapter: "Synthetic", title: scene.id, summary: "Synthetic planned beat", artDirection: "geometry", targetMinutes: 1, background: "title" })),
  });
  const content = { kind: "candidate-preview", previewId: FIXTURE_IDS.preview, projectId: sourceHead.projectId,
    runId: FIXTURE_IDS.run, candidateId: FIXTURE_IDS.candidate, candidateRevision: 1, sourceHead,
    entry: { kind: "from-start", sceneId: "ch01-lab" }, materializedScenes, cast: [], initialFlags: { visits: 0 }, assetBindings: [],
    boundaries: [{ fromSceneId: "ch01-exit", choiceId: "continue", targetSceneId: "ch02-arrival", reason: "unwritten-scene" }],
    includedUnitHashes: await Promise.all(materializedScenes.map(canonicalHash)),
  };
  const preview = parsePreviewSnapshot({ ...content, snapshotHash: await canonicalHash(content) });
  return { outline, preview, expected: { materialized: 3, planned: 4, endingEvents: 0,
    boundary: { fromSceneId: "ch01-exit", choiceId: "continue", targetSceneId: "ch02-arrival", reason: "unwritten-scene" },
    flagsBeforeChoice: { visits: 0 }, flagsAtBoundary: { visits: 0 }, sourceWrites: 0 } } as const;
}
