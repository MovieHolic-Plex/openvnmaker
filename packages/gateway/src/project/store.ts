/**
 * 로컬 프로젝트 파일. 모델에게 자유 경로를 주지 않는다 — 노드 id 만 받는다.
 * 기본 루트는 ~/.vnmaker/projects/default.
 *
 * 손상 규칙: 파일이 없으면 null/[] 이지만, 있으면서 깨졌으면 오류로 올린다.
 * null 로 삼키면 다음 쓰기가 빈 상태 위에 실행돼 기존 데이터를 조용히 날린다.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { asCondition, parseBeats } from "@vnmaker/ir";
import type { LineCondition } from "@vnmaker/ir";
import { validCharacterKey } from "@vnmaker/content";
import type { Character } from "@vnmaker/content";
import { writeFileAtomic } from "../atomic.js";
import { PROJECT_DIR } from "../config.js";

const NODE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ProjectNode {
  readonly id: string;
  readonly label?: string;
  readonly beats: readonly unknown[];
}

export interface ProjectEdge {
  readonly from: string;
  readonly to: string;
  /** 구조화 표시 조건 — 구버전의 플래그명 문자열은 읽을 때 {all:[이름]} 으로 정규화된다. */
  readonly when?: LineCondition;
}

/** story/characters.json — 그래프가 참조하는 등장인물의 표시명·색·소개. 선택 파일이다. */
export interface ProjectMeta {
  readonly title?: string;
  readonly subtitle?: string;
}

export interface ProjectStore {
  writeNode(node: ProjectNode): Promise<{ path: string }>;
  readNode(id: string): Promise<ProjectNode | null>;
  listNodes(): Promise<readonly ProjectNode[]>;
  readEdges(): Promise<readonly ProjectEdge[]>;
  writeEdges(edges: readonly ProjectEdge[]): Promise<{ path: string }>;
  /**
   * 엣지 read→mutate→write 를 저장소 안에서 직렬화한다.
   * 동시 connect 가 한쪽 엣지를 지우지 않게 이 경로로만 수정한다.
   */
  updateEdges(mutate: (edges: readonly ProjectEdge[]) => readonly ProjectEdge[]): Promise<{ path: string; edges: readonly ProjectEdge[] }>;
  /** 선택 파일 story/characters.json — 없으면 빈 배열, 있으면서 깨졌으면 오류. */
  readCharacters?(): Promise<readonly Character[]>;
  /** 선택 파일 vnmaker.json — 컴파일된 원고의 제목·부제를 덮는다. */
  readMeta?(): Promise<ProjectMeta>;
}

export function assertSafeNodeId(id: string): string {
  if (!NODE_ID.test(id)) throw new Error("노드 id 는 소문자·숫자·하이픈만 된다");
  return id;
}

function asNode(value: unknown): ProjectNode {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("노드 JSON 이 객체가 아니다");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw["id"] !== "string") throw new Error("노드 id 가 없다");
  const id = assertSafeNodeId(raw["id"]);
  if (!Array.isArray(raw["beats"])) throw new Error("노드 beats 가 없다");
  const label = raw["label"];
  return {
    id,
    beats: raw["beats"],
    ...(typeof label === "string" && label !== "" ? { label } : {}),
  };
}

/** 쓰기 경로 전용 검증 — 비트 하나하나가 알려진 op 여야 디스크에 남긴다. */
function asWritableNode(value: unknown): ProjectNode {
  const node = asNode(value);
  return { ...node, beats: parseBeats(node.beats) };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(entry => typeof entry === "string");
}

function isOutfitImages(value: unknown): boolean {
  return isStringRecord(value) === false && value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(isStringRecord);
}

function asEdge(value: unknown): ProjectEdge {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("엣지가 객체가 아니다");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw["from"] !== "string" || typeof raw["to"] !== "string") throw new Error("엣지에 from/to 가 없다");
  const when = raw["when"];
  return {
    from: assertSafeNodeId(raw["from"]),
    to: assertSafeNodeId(raw["to"]),
    ...(when === undefined || when === "" ? {} : { when: asCondition(when) }),
  };
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

export function createMemoryProjectStore(seed: readonly ProjectNode[] = []): ProjectStore {
  const nodes = new Map<string, ProjectNode>(seed.map((node) => [node.id, node]));
  let edges: ProjectEdge[] = [];
  let edgeQueue: Promise<unknown> = Promise.resolve();
  return {
    async writeNode(node) {
      const parsed = asWritableNode(node);
      nodes.set(parsed.id, parsed);
      return { path: `story/nodes/${parsed.id}.json` };
    },
    async readNode(id) {
      try {
        return nodes.get(assertSafeNodeId(id)) ?? null;
      } catch {
        return null;
      }
    },
    async listNodes() {
      return [...nodes.values()];
    },
    async readEdges() {
      return edges;
    },
    async writeEdges(next) {
      edges = next.map(asEdge);
      return { path: "story/edges.json" };
    },
    async updateEdges(mutate) {
      const task = edgeQueue.then(async () => {
        edges = mutate(edges).map(asEdge);
        return { path: "story/edges.json", edges };
      });
      edgeQueue = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
}

export function createFileProjectStore(root: string = PROJECT_DIR): ProjectStore {
  const nodesDir = join(root, "story", "nodes");
  const edgesFile = join(root, "story", "edges.json");
  let edgeQueue: Promise<unknown> = Promise.resolve();

  const readEdgesFile = async (): Promise<readonly ProjectEdge[]> => {
    let raw: string;
    try {
      raw = await readFile(edgesFile, "utf8");
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as { edges?: unknown };
      if (!Array.isArray(parsed.edges)) throw new Error("edges 필드가 배열이 아니다");
      return parsed.edges.map(asEdge);
    } catch (error) {
      throw new Error(`edges.json 이 손상됐다 — 빈 그래프로 덮어쓰지 않는다: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const writeEdgesFile = async (edges: readonly ProjectEdge[]): Promise<{ path: string }> => {
    await writeFileAtomic(edgesFile, `${JSON.stringify({ edges }, null, 2)}\n`);
    return { path: "story/edges.json" };
  };

  const readOptionalJson = async (path: string, label: string): Promise<unknown | null> => {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`${label} 이 손상됐다: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    async writeNode(node) {
      const parsed = asWritableNode(node);
      const rel = `story/nodes/${parsed.id}.json`;
      await writeFileAtomic(join(root, rel), `${JSON.stringify(parsed, null, 2)}\n`);
      try {
        await readFile(join(root, "vnmaker.json"), "utf8");
      } catch {
        await writeFileAtomic(
          join(root, "vnmaker.json"),
          `${JSON.stringify({ version: 1, title: parsed.label ?? parsed.id, locale: "ko" }, null, 2)}\n`,
        );
      }
      return { path: rel };
    },
    async readNode(id) {
      let safe: string;
      try {
        safe = assertSafeNodeId(id);
      } catch {
        return null; // 형식이 안 맞는 id 는 없는 노드다 — 손상이 아니다
      }
      let raw: string;
      try {
        raw = await readFile(join(nodesDir, `${safe}.json`), "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      try {
        return asNode(JSON.parse(raw) as unknown);
      } catch (error) {
        throw new Error(`노드 파일이 손상됐다 (${safe}): ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async listNodes() {
      let names: string[];
      try {
        names = await readdir(nodesDir);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const nodes: ProjectNode[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        if (!NODE_ID.test(id)) continue;
        const node = await this.readNode(id);
        if (node) nodes.push(node);
      }
      return nodes;
    },
    readEdges: readEdgesFile,
    writeEdges: (next) => writeEdgesFile(next.map(asEdge)),
    async updateEdges(mutate) {
      const task = edgeQueue.then(async () => {
        const edges = mutate(await readEdgesFile()).map(asEdge);
        const { path } = await writeEdgesFile(edges);
        return { path, edges };
      });
      edgeQueue = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    async readCharacters() {
      const raw = await readOptionalJson(join(root, "story", "characters.json"), "characters.json");
      if (raw === null) return [];
      const rows = (raw as { characters?: unknown })?.characters ?? raw;
      if (!Array.isArray(rows)) throw new Error("characters.json 이 배열이 아니다");
      return rows.map((row) => {
        const item = row as Record<string, unknown>;
        if (item === null || typeof item !== "object" || !validCharacterKey(item["id"]) || typeof item["name"] !== "string" || item["name"] === "") {
          throw new Error("characters.json 항목은 영문 id 와 이름이 필요하다");
        }
        return {
          id: item["id"] as Character["id"],
          name: item["name"],
          color: typeof item["color"] === "string" ? item["color"] : "#b7c6d4",
          bio: typeof item["bio"] === "string" ? item["bio"] : "",
          // 스토어 설치·직접 가져온 표정 그림 — 문자열 맵만 통과시키고 나머지 검증은 parseScript 에 맡긴다.
          ...(isStringRecord(item["expressionImages"]) ? { expressionImages: item["expressionImages"] as NonNullable<Character["expressionImages"]> } : {}),
          ...(Array.isArray(item["outfits"]) && item["outfits"].every(row => typeof row === "string") ? { outfits: item["outfits"] as string[] } : {}),
          ...(isOutfitImages(item["outfitImages"]) ? { outfitImages: item["outfitImages"] as NonNullable<Character["outfitImages"]> } : {}),
          ...(item["chromaKey"] === "#00ff00" ? { chromaKey: "#00ff00" as const } : {}),
        };
      });
    },
    async readMeta() {
      const raw = await readOptionalJson(join(root, "vnmaker.json"), "vnmaker.json");
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
      const row = raw as Record<string, unknown>;
      return {
        ...(typeof row["title"] === "string" && row["title"] !== "" ? { title: row["title"] } : {}),
        ...(typeof row["subtitle"] === "string" && row["subtitle"] !== "" ? { subtitle: row["subtitle"] } : {}),
      };
    },
  };
}
