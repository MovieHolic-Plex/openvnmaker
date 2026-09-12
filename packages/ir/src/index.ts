import type { Character, CharacterId, Choice, Expression, Line, Scene, SpriteSlot, VnScript } from "@vnmaker/content";

export type SceneBeat = {
  readonly op: "scene";
  readonly bg: string;
  readonly bgm?: string;
  readonly chapter?: string;
  readonly cg?: string;
};

export type SayBeat = {
  readonly op: "say";
  readonly who: string | null;
  readonly text: string;
  readonly expression?: string;
  readonly sfx?: string;
  readonly shake?: boolean;
};

export type ShowBeat = {
  readonly op: "show";
  readonly who: string;
  readonly slot: SpriteSlot;
  readonly expression: string;
  readonly outfit?: string;
};

export type HideBeat = {
  readonly op: "hide";
  readonly who: string;
};

export interface MenuChoice {
  readonly text: string;
  readonly to: string;
  readonly when?: string;
  readonly set?: Record<string, string | number | boolean>;
}

export type MenuBeat = {
  readonly op: "menu";
  readonly choices: readonly MenuChoice[];
};

export type JumpBeat = {
  readonly op: "jump";
  readonly to: string;
};

export type SetBeat = {
  readonly op: "set";
  readonly vars: Record<string, string | number | boolean>;
};

export type PlayBeat = {
  readonly op: "play";
  readonly kind: "bgm" | "sfx";
  readonly sound: string;
  readonly loop?: boolean;
};

export type PauseBeat = {
  readonly op: "pause";
  readonly ms?: number;
};

export type EndingBeat = {
  readonly op: "ending";
  readonly title: string;
};

export type Beat = SceneBeat | SayBeat | ShowBeat | HideBeat | MenuBeat | JumpBeat | SetBeat | PlayBeat | PauseBeat | EndingBeat;

/** content 스키마의 넓어진 계약을 IR 에서 미리 받는 컴파일 결과 타입. VnScript 에 대입된다. */
export interface CompiledChoice extends Choice {
  readonly cond?: string;
  readonly set?: Record<string, string | number | boolean>;
  readonly disable?: boolean;
}

export interface CompiledScene extends Scene {
  readonly cg?: string;
  readonly choices?: readonly CompiledChoice[];
}

export interface CompiledScript extends VnScript {
  readonly flags?: Record<string, string | number | boolean>;
  readonly scenes: readonly CompiledScene[];
}

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

function asNonEmpty(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value.trim();
}

function asFlagVars(value: unknown, message: string): Record<string, string | number | boolean> {
  const raw = asRecord(value);
  const vars: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
      throw new Error(message);
    }
    vars[key] = entry;
  }
  return vars;
}

function parseMenuChoice(value: unknown): MenuChoice {
  const raw = asRecord(value);
  const text = asNonEmpty(raw["text"], "menu.text 가 없다").replace(/\s+/g, " ");
  if (typeof raw["to"] !== "string") throw new Error("menu.to 가 없다");
  const to = assertSafeNodeId(raw["to"]);
  const when = raw["when"];
  const set = raw["set"];
  return {
    text,
    to,
    ...(typeof when === "string" && when.trim() !== "" ? { when: when.trim() } : {}),
    ...(set === undefined ? {} : { set: asFlagVars(set, "menu.set 이 잘못됐다") }),
  };
}

export function parseBeat(value: unknown): Beat {
  const beat = asRecord(value);
  const op = beat["op"];
  if (op === "scene") {
    const bg = beat["bg"];
    if (typeof bg !== "string" || bg.trim() === "") throw new Error("scene.bg 가 없다");
    const parsed: SceneBeat = { op: "scene", bg: bg.trim() };
    const bgm = beat["bgm"];
    const chapter = beat["chapter"];
    const cg = beat["cg"];
    return {
      ...parsed,
      ...(typeof bgm === "string" && bgm !== "" ? { bgm } : {}),
      ...(typeof chapter === "string" && chapter !== "" ? { chapter } : {}),
      ...(typeof cg === "string" && cg !== "" ? { cg } : {}),
    };
  }
  if (op === "say") {
    const text = beat["text"];
    if (typeof text !== "string" || text.trim() === "") throw new Error("say.text 가 없다");
    const who = beat["who"];
    if (who !== null && who !== undefined && typeof who !== "string") throw new Error("say.who 가 잘못됐다");
    const expression = beat["expression"];
    const sfx = beat["sfx"];
    return {
      op: "say",
      who: typeof who === "string" && who !== "" ? who : null,
      text: text.trim().replace(/\s+/g, " "),
      ...(typeof expression === "string" && expression !== "" ? { expression } : {}),
      ...(typeof sfx === "string" && sfx !== "" ? { sfx } : {}),
      ...(beat["shake"] === true ? { shake: true as const } : {}),
    };
  }
  if (op === "show") {
    const who = asNonEmpty(beat["who"], "show.who 가 없다");
    const slot = beat["slot"];
    if (slot !== "left" && slot !== "center" && slot !== "right") throw new Error("show.slot 이 잘못됐다");
    const expression = asNonEmpty(beat["expression"], "show.expression 이 없다");
    const outfit = beat["outfit"];
    return {
      op: "show",
      who,
      slot,
      expression,
      ...(typeof outfit === "string" && outfit !== "" ? { outfit } : {}),
    };
  }
  if (op === "hide") {
    return { op: "hide", who: asNonEmpty(beat["who"], "hide.who 가 없다") };
  }
  if (op === "menu") {
    if (!Array.isArray(beat["choices"]) || beat["choices"].length === 0) throw new Error("menu.choices 가 없다");
    return { op: "menu", choices: beat["choices"].map(parseMenuChoice) };
  }
  if (op === "jump") {
    if (typeof beat["to"] !== "string") throw new Error("jump.to 가 없다");
    return { op: "jump", to: assertSafeNodeId(beat["to"]) };
  }
  if (op === "set") {
    if (beat["vars"] === undefined) throw new Error("set.vars 가 없다");
    return { op: "set", vars: asFlagVars(beat["vars"], "set.vars 가 잘못됐다") };
  }
  if (op === "play") {
    const kind = beat["kind"];
    if (kind !== "bgm" && kind !== "sfx") throw new Error("play.kind 가 잘못됐다");
    const sound = asNonEmpty(beat["sound"], "play.sound 가 없다");
    const loop = beat["loop"];
    return {
      op: "play",
      kind,
      sound,
      ...(typeof loop === "boolean" ? { loop } : {}),
    };
  }
  if (op === "pause") {
    const ms = beat["ms"];
    return {
      op: "pause",
      ...(ms === undefined ? {} : typeof ms === "number" ? { ms } : (() => { throw new Error("pause.ms 가 잘못됐다"); })()),
    };
  }
  if (op === "ending") {
    return { op: "ending", title: asNonEmpty(beat["title"], "ending.title 이 없다") };
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
  return who as Line["speaker"];
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
    if (beat.op !== "say") continue;
    lines.push({
      speaker: speakerOf(beat.who),
      text: beat.text,
      ...(beat.expression === undefined ? {} : { expression: beat.expression as Expression }),
      ...(beat.sfx === undefined ? {} : { sfx: beat.sfx }),
      ...(beat.shake === true ? { shake: true as const } : {}),
    });
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

function compileGraphNode(node: StoryNode, edgeTo: string | undefined): CompiledScene {
  let background = "title";
  let bgm: string | undefined;
  let chapter: string | undefined;
  let cg: string | undefined;
  let ending: string | undefined;
  let jumpTo: string | undefined;
  let pendingSfx: string | undefined;
  const lines: Line[] = [];
  const choices: CompiledChoice[] = [];
  const sprites = new Map<string, { slot: SpriteSlot; character: string; expression?: string }>();

  for (const beat of node.beats) {
    switch (beat.op) {
      case "scene":
        background = beat.bg;
        bgm = beat.bgm;
        chapter = beat.chapter;
        cg = beat.cg;
        break;
      case "say": {
        const sfx = beat.sfx ?? pendingSfx;
        pendingSfx = undefined;
        lines.push({
          speaker: beat.who as Line["speaker"],
          text: beat.text,
          ...(beat.expression === undefined ? {} : { expression: beat.expression as Expression }),
          ...(sfx === undefined ? {} : { sfx }),
          ...(beat.shake === true ? { shake: true as const } : {}),
        });
        break;
      }
      case "show": {
        for (const [slot, dir] of sprites) {
          if (dir.character === beat.who) sprites.delete(slot);
        }
        sprites.set(beat.slot, {
          slot: beat.slot,
          character: beat.who,
          ...(beat.expression === undefined ? {} : { expression: beat.expression }),
        });
        break;
      }
      case "hide": {
        for (const [slot, dir] of sprites) {
          if (dir.character === beat.who) sprites.delete(slot);
        }
        break;
      }
      case "menu": {
        for (const choice of beat.choices) {
          // when 은 표현식 문자열이고 cond 의미는 아직 미정 — 조용히 꿰는 대신 거부한다.
          // (파서와 네이티브 exporter 모두 cond 를 거부하므로 여기서내도 쓸 수 없다.)
          if (choice.when !== undefined) {
            throw new Error(`menu.when 의 조건 표현 의미가 정해지지 않았다 — 노드 ${node.id}`);
          }
          choices.push({
            text: choice.text,
            next: choice.to,
            ...(choice.set === undefined ? {} : { set: { ...choice.set } }),
          });
        }
        break;
      }
      case "jump":
        if (jumpTo === undefined) jumpTo = beat.to;
        break;
      case "set":
        // set 은 노드 실행 시점 적용이어야 한다 — 컴파일 타임 전역 폴딩은 도달 여부와 무관하게
        // 플래그를 박아 의미를 깬다. 실행 시점 의미가 정해질 때까지 거부한다.
        throw new Error(`set 비트의 컴파일 의미가 정해지지 않았다 — 노드 ${node.id}`);
      case "play":
        if (beat.kind === "bgm") bgm = beat.sound;
        else pendingSfx = beat.sound;
        break;
      case "pause":
        break;
      case "ending":
        ending = beat.title;
        break;
    }
  }

  const spriteList = [...sprites.values()].map((dir) => ({
    slot: dir.slot,
    character: dir.character as CharacterId,
    ...(dir.expression === undefined ? {} : { expression: dir.expression as Expression }),
  }));
  // jump 와 엣지가 서로 다른 곳을 가리키면 어느 쪽이 진짜 다음인지 미정 — 조용히 버리지 않는다.
  if (jumpTo !== undefined && edgeTo !== undefined && jumpTo !== edgeTo) {
    throw new Error(`노드 ${node.id} 의 jump(${jumpTo})와 엣지(${edgeTo})가 서로 다른 다음을 가리킨다`);
  }
  const next = jumpTo ?? edgeTo;
  // 선택지와 나가는 엣지/jump 가 공존하면 어느 쪽이 다음을 정하는지 미정 — 조용히 버리지 않는다.
  if (choices.length > 0 && next !== undefined) {
    throw new Error(`노드 ${node.id} 에 선택지와 다음 엣지가 함께 있다 — 분기 표현이 정해지지 않았다`);
  }

  return {
    id: node.id,
    background,
    lines,
    ...(bgm === undefined ? {} : { bgm }),
    ...(chapter === undefined ? {} : { chapter }),
    ...(cg === undefined ? {} : { cg }),
    ...(spriteList.length === 0 ? {} : { sprites: spriteList }),
    ...(choices.length === 0 ? {} : { choices }),
    ...(choices.length > 0 || next === undefined ? {} : { next }),
    ...(ending === undefined ? {} : { ending }),
  };
}

export function compileGraph(
  nodes: readonly StoryNode[],
  edges: readonly StoryEdge[],
  characters: readonly Character[] = [],
): CompiledScript {
  if (nodes.length === 0) throw new Error("노드가 없다");
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) throw new Error(`노드 id 가 겹친다: ${node.id}`);
    seen.add(node.id);
  }
  const edgeNext = new Map<string, string>();
  for (const edge of edges) {
    // 다중 출발 엣지와 엣지 조건의 표현은 아직 미정 — 첫 엣지만 살리는 건 의미 파괴다.
    if (!seen.has(edge.from) || !seen.has(edge.to)) {
      throw new Error(`엣지가 없는 노드를 가리킨다: ${edge.from} → ${edge.to}`);
    }
    if (edge.when !== undefined) {
      throw new Error(`엣지 조건(when)의 컴파일 의미가 정해지지 않았다: ${edge.from} → ${edge.to}`);
    }
    if (edgeNext.has(edge.from)) {
      throw new Error(`노드 ${edge.from} 에서 나가는 엣지가 여러 개다 — 분기 표현이 정해지지 않았다`);
    }
    edgeNext.set(edge.from, edge.to);
  }
  const scenes = nodes.map((node) => compileGraphNode(node, edgeNext.get(node.id)));
  // 엣지뿐 아니라 jump·menu 선택지의 도착지도 실재해야 한다 — dangling 참조는 여기서 잡는다.
  for (const scene of scenes) {
    if (scene.next !== undefined && !seen.has(scene.next)) {
      throw new Error(`노드 ${scene.id} 의 next 가 없는 노드를 가리킨다: ${scene.next}`);
    }
    for (const choice of scene.choices ?? []) {
      if (!seen.has(choice.next)) {
        throw new Error(`노드 ${scene.id} 의 선택지가 없는 노드를 가리킨다: ${choice.next}`);
      }
    }
  }
  const first = nodes[0];
  if (first === undefined) throw new Error("노드가 없다");
  return {
    title: first.label ?? first.id,
    subtitle: "그래프 컴파일",
    start: first.id,
    characters,
    scenes,
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
