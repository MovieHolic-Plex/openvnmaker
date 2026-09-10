import { hashSchema, parseRun, DEFAULT_BUDGET_LIMITS, contextManifestSchema, unitIdSchema } from "../../harness/src/index.js";
import type { Run, Unit } from "../../harness/src/index.js";
import { HASH, IDS, sequentialIds } from "./harness-runner-fixtures.js";
import { head } from "../../harness/test/fixtures.js";
import type {
  CreateProductionInput, ProductionBeat, ProductionCastDraft, ProductionScene, SourceHead,
} from "../src/harness/production.js";

export const SOURCE_HEAD: SourceHead = {
  projectId: head.projectId,
  lineageId: head.lineageId,
  revision: 0,
  scriptHash: HASH.a,
  productionHash: HASH.b,
};

export const LIGHTHOUSE_BRIEF = "겨울 등대. 승인된 인물만 등장한다. 대학 캠퍼스와 샘플 인물을 사용하지 않는다.";

export function labelHasher(): { readonly hash: (label: string) => string } {
  const seen = new Map<string, string>();
  let n = 1;
  return {
    hash: (label) => {
      const existing = seen.get(label);
      if (existing !== undefined) return existing;
      const value = hashSchema.parse(n.toString(16).padStart(64, "0"));
      n += 1;
      seen.set(label, value);
      return value;
    },
  };
}

export function characterIds(): { readonly characterId: () => string } {
  let n = 0;
  return { characterId: () => `hero${n += 1}` };
}

export function sessionIds(): CreateProductionInput["ids"] {
  return { uuid: sequentialIds(80).uuid, ...characterIds() };
}

export const CAST_DRAFTS: readonly ProductionCastDraft[] = [
  { name: "은하", color: "#88aaff", bio: "등대 지기" },
  { name: "도윤", color: "#ffaa88", bio: "겨울 항해사" },
  { name: "미래", color: "#aaffcc", bio: "기상 관측원" },
  { name: "하린", color: "#ddaaff", bio: "등대 조수" },
  { name: "준호", color: "#ffe088", bio: "보급선 선장" },
  { name: "서하", color: "#88ddff", bio: "기록 보관원" },
];

export function placeholderScene(): ProductionScene {
  return {
    id: "placeholder", chapterId: "setup", background: "title",
    lines: [{ id: "ph-l1", speaker: null, text: "빈 작품의 시작." }], ending: "초안",
  };
}

function beat(
  id: string, chapterId: string, exit: Pick<ProductionBeat, "next" | "choices" | "ending">,
): ProductionBeat {
  return {
    id, chapterId, title: id, summary: `${id}에서 등대 근무가 흔들리고 동기가 드러난다.`,
    artDirection: "겨울 등대, 찬 조명, 파도 포말, 고정 카메라.", targetMinutes: 4, background: "title",
    ...exit,
  };
}

/** Six chapters, closed graph, lighthouse-only staging. */
export function sixChapterBeats(): readonly ProductionBeat[] {
  return [
    beat("ch01-s1", "ch01", { next: "ch01-s2" }),
    beat("ch01-s2", "ch01", { next: "ch01-s3" }),
    beat("ch01-s3", "ch01", { choices: [{ text: "항로를 연다", next: "ch02-s1" }, { text: "등대를 지킨다", next: "ch02-alt" }] }),
    beat("ch02-s1", "ch02", { next: "ch03-s1" }),
    beat("ch02-alt", "ch02", { next: "ch03-s1" }),
    beat("ch03-s1", "ch03", { next: "ch03-s2" }),
    beat("ch03-s2", "ch03", { next: "ch04-s1" }),
    beat("ch04-s1", "ch04", { next: "ch04-s2" }),
    beat("ch04-s2", "ch04", { next: "ch05-s1" }),
    beat("ch05-s1", "ch05", { next: "ch06-s1" }),
    beat("ch06-s1", "ch06", { choices: [{ text: "불을 끈다", next: "ch06-a" }, { text: "불을 지킨다", next: "ch06-b" }] }),
    beat("ch06-a", "ch06", { ending: "꺼진 등대" }),
    beat("ch06-b", "ch06", { ending: "남은 불" }),
  ];
}

export function partialBeats(): readonly ProductionBeat[] {
  return [
    beat("ch01-s1", "ch01", { next: "ch01-s2" }),
    beat("ch01-s2", "ch01", { next: "ch01-s3" }),
    beat("ch01-s3", "ch01", { choices: [{ text: "다음 장으로", next: "ch02-arrival" }, { text: "남는다", next: "ch01-end" }] }),
    beat("ch01-end", "ch01", { ending: "첫 장의 밤" }),
    beat("ch02-arrival", "ch02", { next: "ch03-s1" }),
    beat("ch03-s1", "ch03", { next: "ch04-s1" }),
    beat("ch04-s1", "ch04", { next: "ch05-s1" }),
    beat("ch05-s1", "ch05", { next: "ch06-s1" }),
    beat("ch06-s1", "ch06", { next: "ch06-a" }),
    beat("ch06-a", "ch06", { ending: "먼 불" }),
  ];
}

export function draftFromBeat(beatRow: ProductionBeat, speaker: string): ProductionScene {
  return {
    id: beatRow.id, chapterId: beatRow.chapterId, background: beatRow.background,
    lines: [
      { id: `${beatRow.id}-l1`, speaker, text: `${beatRow.id}에서 등대를 지키려는 동기가 드러난다.` },
      { id: `${beatRow.id}-l2`, speaker: null, text: "찬 조명 아래 파도가 벽면을 친다." },
    ],
    ...(beatRow.next === undefined ? {} : { next: beatRow.next }),
    ...(beatRow.choices === undefined ? {} : { choices: beatRow.choices }),
    ...(beatRow.ending === undefined ? {} : { ending: beatRow.ending }),
  };
}

export function twentySceneWork(speaker: string): {
  readonly scenes: readonly ProductionScene[];
  readonly beats: readonly ProductionBeat[];
} {
  const scenes = Array.from({ length: 20 }, (_, index) => {
    const id = `scene_${index}`;
    const chapterId = `ch${String(Math.floor(index / 4) + 1).padStart(2, "0")}`;
    const ending = index === 19;
    return {
      id, chapterId, background: "title" as const,
      lines: [
        { id: `${id}-l1`, speaker, text: `${id} 동기의 첫 줄.` },
        { id: `${id}-l2`, speaker: null, text: `${id} 연출의 둘째 줄.` },
      ],
      ...(ending ? { ending: "기존 결말" } : { next: `scene_${index + 1}` }),
    };
  });
  const beats = scenes.map(scene => ({
    id: scene.id, chapterId: scene.chapterId, title: scene.id,
    summary: `${scene.id} 기존 사건의 요약.`, artDirection: "기존 작품의 조명.",
    targetMinutes: 3, background: "title",
    ...(scene.next === undefined ? {} : { next: scene.next }),
    ...(scene.ending === undefined ? {} : { ending: scene.ending }),
  }));
  return { scenes, beats };
}

export function pendingHarnessUnit(id: string, kind: Unit["kind"], dependencyHashes: readonly string[]): Unit {
  return {
    id: unitIdSchema.parse(id), kind, dependencyHashes: dependencyHashes.map(value => hashSchema.parse(value)),
    contextManifest: contextManifestSchema.parse({
      sourceHead: head, inputContentHash: HASH.a, windows: [], facts: [], readSet: [],
      referenceBindingHashes: [], excluded: [],
    }),
    autoRepairRound: 0, status: "pending",
  };
}

export function linearBeats(count: number, minutes: number, title: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `scene_${index}`, chapter: `ch${Math.floor(index / 8) + 1}`,
    title: `${title} ${index}`, summary: `${title} ${index}에서 등대 사건이 진행되고 동기가 드러난다.`,
    artDirection: "겨울 등대 조명과 파도.", targetMinutes: minutes, background: "title",
    ...(index === count - 1 ? { ending: "결말" } : { next: `scene_${index + 1}` }),
  }));
}

export function productionRun(units: readonly Unit[], runId: string): Run {
  return parseRun({
    schemaVersion: 1, id: runId, version: 0, sourceHead: { ...head, revision: 0 },
    candidateRef: { candidateId: IDS.candidate, revision: 0 },
    state: { status: "idle" }, units, proposalIds: [], budgetGroupId: IDS.group, budgetOwnerRunId: runId,
    limitVersion: 0, limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only",
    lastEventSeq: 0, ownerEpoch: 0, createdAt: "2026-09-09T00:00:00.000Z",
  });
}
