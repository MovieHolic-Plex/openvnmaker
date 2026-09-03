/**
 * 로컬 프로젝트 파일. 모델에게 자유 경로를 주지 않는다 — 노드 id 만 받는다.
 * 기본 루트는 ~/.vnmaker/projects/default.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  readonly when?: string;
}

export interface ProjectStore {
  writeNode(node: ProjectNode): Promise<{ path: string }>;
  readNode(id: string): Promise<ProjectNode | null>;
  listNodes(): Promise<readonly ProjectNode[]>;
  readEdges(): Promise<readonly ProjectEdge[]>;
  writeEdges(edges: readonly ProjectEdge[]): Promise<{ path: string }>;
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
    ...(typeof when === "string" && when !== "" ? { when } : {}),
  };
}

export function createMemoryProjectStore(seed: readonly ProjectNode[] = []): ProjectStore {
  const nodes = new Map<string, ProjectNode>(seed.map((node) => [node.id, node]));
  let edges: ProjectEdge[] = [];
  return {
    async writeNode(node) {
      const parsed = asNode(node);
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
  };
}

export function createFileProjectStore(root: string = PROJECT_DIR): ProjectStore {
  return {
    async writeNode(node) {
      const parsed = asNode(node);
      const rel = `story/nodes/${parsed.id}.json`;
      const dir = join(root, "story", "nodes");
      await mkdir(dir, { recursive: true });
      await writeFile(join(root, rel), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      try {
        await readFile(join(root, "vnmaker.json"), "utf8");
      } catch {
        await writeFile(
          join(root, "vnmaker.json"),
          `${JSON.stringify({ version: 1, title: parsed.label ?? parsed.id, locale: "ko" }, null, 2)}\n`,
          "utf8",
        );
      }
      return { path: rel };
    },
    async readNode(id) {
      let raw: string;
      try {
        raw = await readFile(join(root, "story", "nodes", `${assertSafeNodeId(id)}.json`), "utf8");
      } catch {
        return null;
      }
      try {
        return asNode(JSON.parse(raw) as unknown);
      } catch {
        return null;
      }
    },
    async listNodes() {
      let names: string[];
      try {
        names = await readdir(join(root, "story", "nodes"));
      } catch {
        return [];
      }
      const nodes: ProjectNode[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        const node = await this.readNode(id);
        if (node) nodes.push(node);
      }
      return nodes;
    },
    async readEdges() {
      let raw: string;
      try {
        raw = await readFile(join(root, "story", "edges.json"), "utf8");
      } catch {
        return [];
      }
      try {
        const parsed = JSON.parse(raw) as { edges?: unknown };
        if (!Array.isArray(parsed.edges)) return [];
        return parsed.edges.map(asEdge);
      } catch {
        return [];
      }
    },
    async writeEdges(next) {
      const edges = next.map(asEdge);
      await mkdir(join(root, "story"), { recursive: true });
      await writeFile(join(root, "story", "edges.json"), `${JSON.stringify({ edges }, null, 2)}\n`, "utf8");
      return { path: "story/edges.json" };
    },
  };
}
