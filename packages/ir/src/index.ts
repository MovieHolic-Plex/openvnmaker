import type { Character, Line, Scene, VnScript } from "@vnmaker/content";

export type SceneBeat = {
  readonly op: "scene";
  readonly bg: string;
  readonly bgm?: string;
  readonly chapter?: string;
};

export type SayBeat = {
  readonly op: "say";
  readonly who: string | null;
  readonly text: string;
};

export type Beat = SceneBeat | SayBeat;

export interface StoryNode {
  readonly id: string;
  readonly label?: string;
  readonly beats: readonly Beat[];
}

const NODE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertSafeNodeId(id: string): string {
  if (!NODE_ID.test(id)) throw new Error("노드 id 는 소문자·숫자·하이픈만 된다");
  return id;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("노드 JSON 이 객체가 아니다");
  }
  return value as Record<string, unknown>;
}

function parseBeat(value: unknown): Beat {
  const beat = asRecord(value);
  const op = beat["op"];
  if (op === "scene") {
    const bg = beat["bg"];
    if (typeof bg !== "string" || bg.trim() === "") throw new Error("scene.bg 가 없다");
    const parsed: SceneBeat = { op: "scene", bg: bg.trim() };
    const bgm = beat["bgm"];
    const chapter = beat["chapter"];
    return {
      ...parsed,
      ...(typeof bgm === "string" && bgm !== "" ? { bgm } : {}),
      ...(typeof chapter === "string" && chapter !== "" ? { chapter } : {}),
    };
  }
  if (op === "say") {
    const text = beat["text"];
    if (typeof text !== "string" || text.trim() === "") throw new Error("say.text 가 없다");
    const who = beat["who"];
    if (who !== null && who !== undefined && typeof who !== "string") throw new Error("say.who 가 잘못됐다");
    return { op: "say", who: typeof who === "string" && who !== "" ? who : null, text: text.trim().replace(/\s+/g, " ") };
  }
  throw new Error("알 수 없는 beat.op");
}

export function parseNode(value: unknown): StoryNode {
  const raw = asRecord(value);
  if (typeof raw["id"] !== "string") throw new Error("노드 id 가 없다");
  const id = assertSafeNodeId(raw["id"]);
  if (!Array.isArray(raw["beats"])) throw new Error("노드 beats 가 없다");
  const beats = raw["beats"].map(parseBeat);
  const label = raw["label"];
  return {
    id,
    beats,
    ...(typeof label === "string" && label !== "" ? { label } : {}),
  };
}

export function helloNode(text: string): StoryNode {
  const line = text.trim().replace(/\s+/g, " ");
  if (line === "") throw new Error("빈 대사는 노드가 되지 않는다");
  return {
    id: "hello",
    label: "한 줄",
    beats: [
      { op: "scene", bg: "title", bgm: "main-theme", chapter: "HELLO" },
      { op: "say", who: null, text: line },
    ],
  };
}

function speakerOf(who: string | null): Line["speaker"] {
  if (who === null || who === "") return null;
  if (who === "me" || who === "seorin" || who === "dohyun" || who === "mirae") return who;
  return null;
}

export function compileNode(node: StoryNode, characters: readonly Character[]): VnScript {
  let background = "title";
  let bgm: string | undefined = "main-theme";
  let chapter: string | undefined;
  const lines: Line[] = [];

  for (const beat of node.beats) {
    if (beat.op === "scene") {
      background = beat.bg;
      bgm = beat.bgm;
      chapter = beat.chapter;
      continue;
    }
    lines.push({ speaker: speakerOf(beat.who), text: beat.text });
  }

  if (lines.length === 0) throw new Error("say 비트가 없다");

  const scene: Scene = {
    id: node.id,
    background,
    lines,
    ending: "그 한 줄",
    transition: "fade",
    ...(bgm === undefined ? {} : { bgm }),
    ...(chapter === undefined ? {} : { chapter }),
  };

  return {
    title: node.label ?? "한 줄",
    subtitle: "모델이 방금 썼다",
    start: node.id,
    characters,
    scenes: [scene],
  };
}

export interface StoryEdge {
  readonly from: string;
  readonly to: string;
  readonly when?: string;
}

export function parseBeats(value: unknown): Beat[] {
  if (!Array.isArray(value)) throw new Error("노드 beats 가 없다");
  return value.map(parseBeat);
}

export function upsertBeats(node: StoryNode, beats: readonly unknown[]): StoryNode {
  const parsed = parseBeats(beats);
  if (!parsed.some((beat) => beat.op === "say")) throw new Error("say 비트가 없다");
  return { ...node, beats: parsed };
}

export function parseEdge(value: unknown): StoryEdge {
  const raw = asRecord(value);
  if (typeof raw["from"] !== "string" || typeof raw["to"] !== "string") throw new Error("엣지에 from/to 가 없다");
  const from = assertSafeNodeId(raw["from"]);
  const to = assertSafeNodeId(raw["to"]);
  const when = raw["when"];
  return {
    from,
    to,
    ...(typeof when === "string" && when !== "" ? { when } : {}),
  };
}

export function connectEdges(edges: readonly StoryEdge[], link: { from: string; to: string; when?: string }): StoryEdge[] {
  const next = parseEdge(link);
  if (edges.some((edge) => edge.from === next.from && edge.to === next.to && (edge.when ?? "") === (next.when ?? ""))) {
    return [...edges];
  }
  return [...edges, next];
}

export function listGraph(
  nodes: readonly StoryNode[],
  edges: readonly StoryEdge[],
): { nodes: { id: string; label: string | undefined }[]; edges: StoryEdge[] } {
  return {
    nodes: nodes.map((node) => ({ id: node.id, label: node.label })),
    edges: [...edges],
  };
}

export function diffBeats(before: readonly Beat[], after: readonly Beat[]): { before: Beat | undefined; after: Beat | undefined }[] {
  const length = Math.max(before.length, after.length);
  const changed: { before: Beat | undefined; after: Beat | undefined }[] = [];
  for (let i = 0; i < length; i += 1) {
    if (JSON.stringify(before[i]) === JSON.stringify(after[i])) continue;
    changed.push({ before: before[i], after: after[i] });
  }
  return changed;
}
