import { parseScript, type VnScript } from "@vnmaker/content";
import {
  parseProductionDocument, parseReviewRecord, type ProductionDocument, type ReviewRecord,
} from "../src/index.js";
import type { WorkspaceValidationInput } from "../src/validation-contracts.js";
import { hash } from "./fixtures.js";

export const HASH = hash;
export const REVIEW_ID = "00000000-0000-4000-8000-000000000021";

function beat(id: string, extra: Record<string, unknown>) {
  return {
    id, chapter: "1", title: id, summary: "beat", artDirection: "still air",
    targetMinutes: 1, background: "title", ...extra,
  };
}

export function outlineDocument(
  scenes: readonly Record<string, unknown>[],
  extra: {
    readonly brief?: string;
    readonly castCanon?: unknown;
    readonly worldTimeline?: unknown;
    readonly branchFacts?: unknown;
    readonly artDirection?: unknown;
    readonly referenceBindings?: unknown;
    readonly endingOutcomes?: unknown;
  } = {},
): ProductionDocument {
  return parseProductionDocument({
    version: 1,
    brief: extra.brief ?? "brief",
    castCanon: extra.castCanon ?? [],
    worldTimeline: extra.worldTimeline ?? [],
    branchFacts: extra.branchFacts ?? [],
    outline: {
      title: "Route", subtitle: "", bible: "bible", start: "start",
      scenes, endingOutcomes: extra.endingOutcomes,
    },
    artDirection: extra.artDirection ?? [],
    referenceBindings: extra.referenceBindings ?? [],
  });
}

export function branchingScript(): VnScript {
  return parseScript({
    title: "Routes", subtitle: "", start: "start", characters: [], flags: {},
    scenes: [
      {
        id: "start", chapter: "1", background: "title",
        lines: [{ id: "l-start", speaker: null, text: "Pick a road." }],
        choices: [
          { id: "c-left", text: "Left", next: "left", set: { route: "left" } },
          { id: "c-right", text: "Right", next: "right", set: { route: "right" } },
        ],
      },
      {
        id: "left", chapter: "1", background: "title",
        lines: [{ id: "l-left", speaker: null, text: "The east wind keeps the shutters talking." }],
        next: "end-left",
      },
      {
        id: "right", chapter: "1", background: "title",
        lines: [{ id: "l-right", speaker: null, text: "The west lamps count the unopened letters." }],
        next: "end-right",
      },
      {
        id: "end-left", chapter: "1", background: "title", ending: "Dawn",
        lines: [{ id: "l-dawn", speaker: null, text: "Morning keeps the promise." }],
      },
      {
        id: "end-right", chapter: "1", background: "title", ending: "Dusk",
        lines: [{ id: "l-dusk", speaker: null, text: "Evening spends the last coin." }],
      },
    ],
  });
}

export function branchingBeats() {
  return [
    beat("start", { choices: [
      { id: "c-left", text: "Left", next: "left", set: { route: "left" } },
      { id: "c-right", text: "Right", next: "right", set: { route: "right" } },
    ] }),
    beat("left", { next: "end-left" }),
    beat("right", { next: "end-right" }),
    beat("end-left", { ending: "Dawn" }),
    beat("end-right", { ending: "Dusk" }),
  ];
}

export function distinctOutcomes() {
  return [
    {
      endingId: "end-left", requiredRouteState: { route: "left" }, resolution: "Dawn holds the promise.",
      cost: "Sleepless watch.", relationshipChanges: ["trust"], openThreads: [],
    },
    {
      endingId: "end-right", requiredRouteState: { route: "right" }, resolution: "Dusk spends the last coin.",
      cost: "Unopened letters.", relationshipChanges: ["distance"], openThreads: ["letter"],
    },
  ];
}

export function identicalOutcomes() {
  return [
    {
      endingId: "end-left", requiredRouteState: {}, resolution: "Same close.",
      cost: "None.", relationshipChanges: [], openThreads: [],
    },
    {
      endingId: "end-right", requiredRouteState: {}, resolution: "Same close.",
      cost: "None.", relationshipChanges: [], openThreads: [],
    },
  ];
}

export function duplicateBeats() {
  return [
    beat("start", { choices: [
      { id: "c-a", text: "A", next: "end-left" },
      { id: "c-b", text: "B", next: "end-right" },
    ] }),
    beat("end-left", { ending: "Title A" }),
    beat("end-right", { ending: "Title B" }),
  ];
}

export function duplicateEndingScript(): VnScript {
  return parseScript({
    title: "Clone", subtitle: "", start: "start", characters: [],
    scenes: [
      {
        id: "start", chapter: "1", background: "title",
        lines: [{ id: "l-start", speaker: null, text: "Pick a door." }],
        choices: [
          { id: "c-a", text: "A", next: "end-left" },
          { id: "c-b", text: "B", next: "end-right" },
        ],
      },
      {
        id: "end-left", chapter: "1", background: "title", ending: "Title A",
        lines: [{ id: "l-a", speaker: null, text: "The end." }],
      },
      {
        id: "end-right", chapter: "1", background: "title", ending: "Title B",
        lines: [{ id: "l-b", speaker: null, text: "The end." }],
      },
    ],
  });
}

export function linearScript(next = "end"): VnScript {
  return parseScript({
    title: "Linear", subtitle: "", start: "start", characters: [],
    scenes: [
      {
        id: "start", chapter: "1", background: "title",
        lines: [{ id: "l-start", speaker: null, text: "Hello there." }],
        next,
      },
      {
        id: "end", chapter: "1", background: "title", ending: "Done",
        lines: [{ id: "l-end", speaker: null, text: "Goodbye now." }],
      },
    ],
  });
}

export function linearBeats(next = "end") {
  return [beat("start", { next }), beat("end", { ending: "Done" })];
}

export function linearOutcome() {
  return [{
    endingId: "end", requiredRouteState: {}, resolution: "Closed.",
    cost: "None.", relationshipChanges: [], openThreads: [],
  }];
}

export function coveringReview(script: VnScript, disposition: ReviewRecord["disposition"] = "pass"): ReviewRecord {
  const lines = script.scenes.flatMap(scene =>
    scene.lines.flatMap(line => line.id === undefined ? [] : [{ sceneId: scene.id, lineId: line.id }]),
  );
  const coverage = script.scenes.map(scene => ({
    sceneId: scene.id,
    lineIds: scene.lines.flatMap(line => line.id === undefined ? [] : [line.id]),
    hash: HASH,
  }));
  const first = lines[0];
  const evidence = first === undefined ? [] : [{
    target: { kind: "line" as const, sceneId: first.sceneId, lineId: first.lineId },
    sourceHash: HASH, excerpt: "cited",
  }];
  return parseReviewRecord({
    reviewId: REVIEW_ID, candidateDigest: HASH, kind: "chapter",
    scope: {
      chapterIds: ["1"], sceneIds: script.scenes.map(scene => scene.id),
      lines, choices: [], assetIds: [],
    },
    coverage, checks: [{ id: "voice", status: "pass", evidence }],
    issues: [], disposition,
  });
}

export function readyInput(script: VnScript, document: ProductionDocument): WorkspaceValidationInput {
  return {
    script, productionDocument: document, reviews: [coveringReview(script)],
    requiredAssetHashes: [], presentAssetHashes: [], assetInspections: [],
    plannedSceneIds: document.outline.scenes.map(scene => scene.id),
    charsPerMinute: 320, pathStateBound: 10000, chapterApprovals: ["1"], quota: null,
  };
}

