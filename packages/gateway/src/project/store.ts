/**
 * 로컬 프로젝트 파일. 모델에게 자유 경로를 주지 않는다 — 노드 id 만 받는다.
 * 기본 루트는 ~/.vnmaker/projects/default.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_DIR } from "../config.js";

const NODE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ProjectNode {
  readonly id: string;
  readonly label?: string;
  readonly beats: readonly unknown[];
}

export interface ProjectStore {
  writeNode(node: ProjectNode): Promise<{ path: string }>;
  readNode(id: string): Promise<ProjectNode | null>;
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

export function createMemoryProjectStore(seed: readonly ProjectNode[] = []): ProjectStore {
  const nodes = new Map<string, ProjectNode>(seed.map((node) => [node.id, node]));
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
  };
}
