import type { Character, CharacterId, Choice, Expression, Line, LineCondition, Scene, SceneRoute, SpriteSlot, VnScript } from "@vnmaker/content";
import { parseCondition, validBackgroundUrl, validFlagName } from "@vnmaker/content";

export type { LineCondition } from "@vnmaker/content";

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
  /** 이 줄에서 배경을 바꾼다 — 설치한 자산 주소(/assets/user/…)만 받는다. */
  readonly bg?: string;
  /** 이 줄에서 전체화면 이미지를 띄운다 — 설치한 자산 주소만 받는다. */
  readonly cg?: string;
};

export type ShowBeat = {
  readonly op: "show";
  readonly who: string;
  readonly slot: SpriteSlot;
  readonly expression: string;
  readonly outfit?: string;
  /** 표정 원화 대신 쓸 임의 이미지 주소(/assets/user/…) — poseUrl 로 나간다. */
  readonly image?: string;
};

export type HideBeat = {
  readonly op: "hide";
  readonly who: string;
};

export interface MenuChoice {
  readonly text: string;
  readonly to: string;
  /** 구조화 표시 조건 {all, none, compare} — 플레이어의 choice.when 과 같다. */
  readonly when?: LineCondition;
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
  readonly routes?: readonly SceneRoute[];
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
    if (!validFlagName(key) || typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
      throw new Error(message);
    }
    vars[key] = entry;
  }
  return vars;
}

/**
 * when 을 구조화 조건으로 읽는다. 객체는 {all, none, compare} 여야 한다.
 * 순수 플래그 이름 문자열("metYuna")은 {all: [이름]} 으로 읽는다 — 문자열 조건식은
 * 지원하지 않으므로 연산자·공백이 섞인 문자열은 여기서 거부한다.
 */
export function asCondition(value: unknown): LineCondition {
  if (typeof value === "string") {
    const name = value.trim();
    if (!validFlagName(name)) {
      throw new Error(`문자열 when 은 플래그 이름만 된다: ${name} — {all:[...], none:[...], compare:[...]} 형태로 써라`);
    }
    return { all: [name] };
  }
  return parseCondition(value);
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
    ...(when === undefined || when === "" ? {} : { when: asCondition(when) }),
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
    const bg = beat["bg"];
    const cg = beat["cg"];
    if (bg !== undefined && !validBackgroundUrl(bg)) throw new Error("say.bg 는 설치한 자산 주소(/assets/user/…)여야 한다");
    if (cg !== undefined && !validBackgroundUrl(cg)) throw new Error("say.cg 는 설치한 자산 주소(/assets/user/…)여야 한다");
    return {
      op: "say",
      who: typeof who === "string" && who !== "" ? who : null,
      text: text.trim().replace(/\s+/g, " "),
      ...(typeof expression === "string" && expression !== "" ? { expression } : {}),
      ...(typeof sfx === "string" && sfx !== "" ? { sfx } : {}),
      ...(beat["shake"] === true ? { shake: true as const } : {}),
      ...(typeof bg === "string" ? { bg } : {}),
      ...(typeof cg === "string" ? { cg } : {}),
    };
  }
  if (op === "show") {
    const who = asNonEmpty(beat["who"], "show.who 가 없다");
    const slot = beat["slot"];
    if (slot !== "left" && slot !== "center" && slot !== "right") throw new Error("show.slot 이 잘못됐다");
    const expression = asNonEmpty(beat["expression"], "show.expression 이 없다");
    const outfit = beat["outfit"];
    const image = beat["image"];
    if (image !== undefined && !validBackgroundUrl(image)) throw new Error("show.image 는 설치한 자산 주소(/assets/user/…)여야 한다");
    return {
      op: "show",
      who,
      slot,
      expression,
      ...(typeof outfit === "string" && outfit !== "" ? { outfit } : {}),
      ...(typeof image === "string" ? { image } : {}),
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

/** 노드의 출구 계약: 조건 경로(routes)가 먼저 평가되고, 무조건 출구(next)는 폴백이다. */
interface NodeExits {
  readonly routes: readonly SceneRoute[];
  readonly next?: string;
}

function compileGraphNode(node: StoryNode, exits: NodeExits): CompiledScene {
  let background = "title";
  let backgroundUrl: string | undefined;
  let bgm: string | undefined;
  let chapter: string | undefined;
  let cg: string | undefined;
  let cgUrl: string | undefined;
  let ending: string | undefined;
  let jumpTo: string | undefined;
  let pendingSfx: string | undefined;
  const lines: Line[] = [];
  const choices: CompiledChoice[] = [];
  const sprites = new Map<string, { slot: SpriteSlot; character: string; expression?: string; outfit?: string; image?: string }>();
  const entrySet: Record<string, string | number | boolean> = {};

  for (const beat of node.beats) {
    switch (beat.op) {
      case "scene":
        // "/…" 주소(스토어 설치·직접 가져온 자산)는 backgroundUrl/cgUrl 로, id 는 내장 자산 키로 나간다.
        if (beat.bg.startsWith("/")) {
          if (!validBackgroundUrl(beat.bg)) throw new Error(`노드 ${node.id} 의 scene.bg 주소가 올바르지 않다: ${beat.bg}`);
          backgroundUrl = beat.bg;
        } else {
          background = beat.bg;
          backgroundUrl = undefined;
        }
        bgm = beat.bgm;
        chapter = beat.chapter;
        if (beat.cg === undefined) { cg = undefined; cgUrl = undefined; }
        else if (beat.cg.startsWith("/")) {
          if (!validBackgroundUrl(beat.cg)) throw new Error(`노드 ${node.id} 의 scene.cg 주소가 올바르지 않다: ${beat.cg}`);
          cg = undefined; cgUrl = beat.cg;
        } else { cg = beat.cg; cgUrl = undefined; }
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
          ...(beat.bg === undefined ? {} : { backgroundUrl: beat.bg }),
          ...(beat.cg === undefined ? {} : { cgUrl: beat.cg }),
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
          ...(beat.outfit === undefined ? {} : { outfit: beat.outfit }),
          ...(beat.image === undefined ? {} : { image: beat.image }),
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
          // 직접 만든 노드의 문자열 when 도 여기서 구조화 조건으로 읽는다 (parseMenuChoice 와 같은 규칙).
          choices.push({
            text: choice.text,
            next: choice.to,
            ...(choice.when === undefined ? {} : { when: asCondition(choice.when) }),
            ...(choice.set === undefined ? {} : { set: { ...choice.set } }),
          });
        }
        break;
      }
      case "jump":
        if (jumpTo === undefined) jumpTo = beat.to;
        break;
      case "set":
        // 노드 안에는 플래그를 읽는 비트가 없다 — 위치와 무관하게 장면 진입 적용과 같다.
        // 같은 키를 두 번 세면 뒤가 이긴다. 직접 만든 노드도 파서를 우회할 수 있으니 여기서도 검증한다.
        for (const [key, entry] of Object.entries(beat.vars)) {
          if (!validFlagName(key)) throw new Error(`노드 ${node.id} 의 set 변수 이름이 올바르지 않다: ${key}`);
          entrySet[key] = entry;
        }
        break;
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

  if (lines.length === 0) throw new Error(`노드 ${node.id} 에 say 비트가 없다 — 장면에는 최소 한 줄이 필요하다`);

  const hasExit = jumpTo !== undefined || exits.next !== undefined || exits.routes.length > 0;
  if (choices.length > 0 && hasExit) {
    throw new Error(`노드 ${node.id} 에 선택지와 다른 출구가 함께 있다 — 분기는 선택지만 정한다`);
  }
  // jump 와 무조건 엣지가 서로 다른 곳을 가리키면 어느 쪽이 기본 다음인지 모호하다.
  if (jumpTo !== undefined && exits.next !== undefined && jumpTo !== exits.next) {
    throw new Error(`노드 ${node.id} 의 jump(${jumpTo})와 엣지(${exits.next})가 서로 다른 다음을 가리킨다`);
  }
  const next = jumpTo ?? exits.next;
  // 엔딩과 무조건 출구가 공존하면 출구가 죽는다 — 조건 경로(충족 시 우선 출구)와 엔딩은 함께 쓸 수 있다.
  if (ending !== undefined && next !== undefined) {
    throw new Error(`노드 ${node.id} 에 엔딩과 무조건 출구가 함께 있다 — 어느 쪽도 죽이지 말고 노드를 나눠라`);
  }

  const spriteList = [...sprites.values()].map((dir) => ({
    slot: dir.slot,
    character: dir.character as CharacterId,
    ...(dir.expression === undefined ? {} : { expression: dir.expression as Expression }),
    ...(dir.outfit === undefined ? {} : { outfit: dir.outfit }),
    ...(dir.image === undefined ? {} : { poseUrl: dir.image }),
  }));

  return {
    id: node.id,
    background,
    lines,
    ...(backgroundUrl === undefined ? {} : { backgroundUrl }),
    ...(bgm === undefined ? {} : { bgm }),
    ...(chapter === undefined ? {} : { chapter }),
    ...(cg === undefined ? {} : { cg }),
    ...(cgUrl === undefined ? {} : { cgUrl }),
    ...(Object.keys(entrySet).length === 0 ? {} : { set: entrySet }),
    ...(spriteList.length === 0 ? {} : { sprites: spriteList }),
    ...(choices.length === 0 ? {} : { choices }),
    ...(choices.length > 0 || exits.routes.length === 0 ? {} : { routes: exits.routes }),
    ...(choices.length > 0 || next === undefined ? {} : { next }),
    ...(ending === undefined ? {} : { ending }),
  };
}

/** 모델이 자유롭게 쓰는 화자 id 를 등장인물로 올린다 — 등록되지 않은 화자는 parseScript 가 거부한다. */
const SYNTH_COLORS = ["#b7c6d4", "#e8c07d", "#9ec9a8", "#d49a9a", "#a9a1d4", "#8fb8c9"];

function collectSpeakers(nodes: readonly StoryNode[], known: ReadonlySet<string>): Character[] {
  const extra: string[] = [];
  for (const node of nodes) {
    for (const beat of node.beats) {
      const who = beat.op === "say" ? beat.who : beat.op === "show" || beat.op === "hide" ? beat.who : undefined;
      if (typeof who !== "string" || who === "" || who === "me" || known.has(who) || extra.includes(who)) continue;
      extra.push(who);
    }
  }
  return extra.map((id, index) => ({
    id: id as CharacterId,
    name: id,
    color: SYNTH_COLORS[index % SYNTH_COLORS.length]!,
    bio: "",
  }));
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
  // 엣지를 출발 노드별로 나눈다: when 있는 것은 조건 경로, 없는 것은 무조건 출구.
  // 무조건 출구는 하나만 허용한다 — 둘 이상이면 뒤는 영원히 도달 불가라 거부한다.
  const exitsByNode = new Map<string, { routes: SceneRoute[]; next?: string }>();
  for (const edge of edges) {
    if (!seen.has(edge.from) || !seen.has(edge.to)) {
      throw new Error(`엣지가 없는 노드를 가리킨다: ${edge.from} → ${edge.to}`);
    }
    const bucket = exitsByNode.get(edge.from) ?? { routes: [] };
    exitsByNode.set(edge.from, bucket);
    // 저장된 구버전 엣지의 문자열 when 도 여기서 구조화 조건으로 읽는다 (parseEdge 와 같은 규칙).
    if (edge.when !== undefined) {
      bucket.routes.push({ next: edge.to, when: asCondition(edge.when) });
    } else if (bucket.next !== undefined && bucket.next !== edge.to) {
      throw new Error(`노드 ${edge.from} 에서 나가는 무조건 엣지가 여러 개다 — 기본 연결은 하나만`);
    } else {
      bucket.next = edge.to;
    }
  }
  const scenes = nodes.map((node) => compileGraphNode(node, exitsByNode.get(node.id) ?? { routes: [] }));
  // 엣지뿐 아니라 jump·menu 선택지·조건 경로의 도착지도 실재해야 한다 — dangling 참조는 여기서 잡는다.
  for (const scene of scenes) {
    if (scene.next !== undefined && !seen.has(scene.next)) {
      throw new Error(`노드 ${scene.id} 의 next 가 없는 노드를 가리킨다: ${scene.next}`);
    }
    for (const route of scene.routes ?? []) {
      if (!seen.has(route.next)) {
        throw new Error(`노드 ${scene.id} 의 조건 경로가 없는 노드를 가리킨다: ${route.next}`);
      }
    }
    for (const choice of scene.choices ?? []) {
      if (!seen.has(choice.next)) {
        throw new Error(`노드 ${scene.id} 의 선택지가 없는 노드를 가리킨다: ${choice.next}`);
      }
    }
  }
  const first = nodes[0];
  if (first === undefined) throw new Error("노드가 없다");
  const known = new Set(characters.map((actor) => actor.id as string));
  return {
    title: first.label ?? first.id,
    subtitle: "그래프 컴파일",
    start: first.id,
    characters: [...characters, ...collectSpeakers(nodes, known)],
    scenes,
  };
}

export interface StoryEdge {
  readonly from: string;
  readonly to: string;
  /** 조건 경로 — 없으면 무조건 출구. 순수 플래그명 문자열은 { all: [이름] }으로 읽힌다. */
  readonly when?: LineCondition;
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
    ...(when === undefined || when === "" ? {} : { when: asCondition(when) }),
  };
}

export function connectEdges(edges: readonly StoryEdge[], link: { from: string; to: string; when?: unknown }): StoryEdge[] {
  const next = parseEdge(link);
  const key = (edge: StoryEdge) => (edge.when === undefined ? "" : JSON.stringify(edge.when));
  if (edges.some((edge) => edge.from === next.from && edge.to === next.to && key(edge) === key(next))) {
    return [...edges];
  }
  // 무조건 출구는 노드당 하나 — 둘째는 영원히 도달 불가라 미리 거부한다 (컴파일 규칙과 같다).
  if (next.when === undefined && edges.some((edge) => edge.from === next.from && edge.when === undefined)) {
    throw new Error(`노드 ${next.from} 에서 나가는 무조건 엣지가 이미 있다 — 조건 경로로 잇거나 기존 연결을 지워라`);
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
